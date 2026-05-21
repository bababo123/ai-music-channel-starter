import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { loadConfig } from "./config/env";
import { createLogger } from "./config/logger";
import { openDatabase } from "./db/database";
import { migrate } from "./db/migrate";
import { buildEpisodePlan } from "./domain/episode-plan";
import { findSeriesConfig } from "./domain/series";
import { MinimaxMusicProvider } from "./providers/minimax-music-provider";
import { NotionDashboardProvider } from "./providers/notion-dashboard-provider";
import { OpenAIImageProvider } from "./providers/openai-image-provider";
import { YouTubeUploadProvider, youtubeAuthScopes } from "./providers/youtube-upload-provider";
import { AssetRepository } from "./repositories/asset-repository";
import { ApprovalRepository } from "./repositories/approval-repository";
import { EpisodePlanRepository } from "./repositories/episode-plan-repository";
import { EpisodeRepository } from "./repositories/episode-repository";
import { PublishPackageRepository } from "./repositories/publish-package-repository";
import { SeriesRepository } from "./repositories/series-repository";
import { TrackRepository } from "./repositories/track-repository";
import { YoutubePerformanceRepository } from "./repositories/youtube-performance-repository";
import { YoutubeUploadRepository } from "./repositories/youtube-upload-repository";
import { AudioMixService } from "./services/audio-mix-service";
import { AudioQcService } from "./services/audio-qc-service";
import { ApprovalService } from "./services/approval-service";
import { ImageGenerationService } from "./services/image-generation-service";
import { MusicGenerationService } from "./services/music-generation-service";
import { NotionSyncService } from "./services/notion-sync-service";
import { resolveYouTubePlaylistTarget, YoutubeUploadService } from "./services/youtube-upload-service";
import { YoutubePublishPackageService } from "./services/youtube-publish-package-service";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);

async function withDatabase<T>(handler: (deps: ReturnType<typeof createDeps>) => T | Promise<T>) {
  const deps = createDeps();

  try {
    return await handler(deps);
  } finally {
    deps.db.close();
  }
}

function createDeps() {
  const db = openDatabase(config);
  migrate(db, logger);

  const seriesRepository = new SeriesRepository(db);
  seriesRepository.seedDefaults();

  return {
    db,
    seriesRepository,
    episodeRepository: new EpisodeRepository(db),
    episodePlanRepository: new EpisodePlanRepository(db),
    trackRepository: new TrackRepository(db),
    assetRepository: new AssetRepository(db),
    publishPackageRepository: new PublishPackageRepository(db),
    approvalRepository: new ApprovalRepository(db),
    youtubePerformanceRepository: new YoutubePerformanceRepository(db),
    youtubeUploadRepository: new YoutubeUploadRepository(db)
  };
}

const program = new Command();

program
  .name("music-channel")
  .description("Automated AI music channel CLI")
  .version("0.1.0");

program.command("db:migrate").description("Apply SQLite migrations and seed series").action(async () => {
  await withDatabase(({ seriesRepository }) => {
    logger.info({ series: seriesRepository.listIds() }, "Database is ready");
  });
});

program
  .command("episode:create")
  .description("Create a planned episode without calling generation providers")
  .requiredOption("--series <seriesId>", "Series ID, e.g. lunar-night-shift")
  .requiredOption("--subtitle <subtitle>", "Episode subtitle")
  .option("--publish-at <isoDate>", "Optional scheduled publish timestamp")
  .action(async (options: { series: string; subtitle: string; publishAt?: string }) => {
    await withDatabase(({ episodeRepository, seriesRepository }) => {
      const series = findSeriesConfig(options.series);

      if (!series) {
        const available = seriesRepository.listIds().join(", ");
        throw new Error(`Unknown series "${options.series}". Available series: ${available}`);
      }

      const plan = buildEpisodePlan(series, options.subtitle);
      const createInput = {
        seriesId: series.id,
        subtitle: options.subtitle,
        outputRoot: config.outputDir,
        plan
      };

      const episode = episodeRepository.createPlannedEpisode(
        options.publishAt ? { ...createInput, publishAt: options.publishAt } : createInput
      );

      console.log(
        JSON.stringify(
          {
            episodeId: episode.id,
            status: "planned",
            title: episode.title,
            outputDir: episode.outputDir,
            trackCount: episode.trackCount,
            totalTargetMinutes: Math.round(episode.totalTargetSeconds / 60)
          },
          null,
          2
        )
      );
    });
  });

program
  .command("episode:refresh-prompts")
  .description("Refresh stored planned track prompts from current series prompt templates")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .action(async (options: { episodeId: string }) => {
    await withDatabase(({ trackRepository, episodePlanRepository }) => {
      const episode = trackRepository.getEpisode(options.episodeId);

      if (!episode) {
        throw new Error(`Episode not found: ${options.episodeId}`);
      }

      const series = findSeriesConfig(episode.seriesId);

      if (!series) {
        throw new Error(`Unknown series on episode: ${episode.seriesId}`);
      }

      const plan = buildEpisodePlan(series, episode.subtitle);
      const result = episodePlanRepository.refreshEpisodePlan({
        episodeId: episode.id,
        plan
      });

      console.log(
        JSON.stringify(
          {
            ...result,
            promptVersion: "lofi-focus-v5",
            note: "Only planned/music_failed tracks were updated. Already generated tracks were left unchanged."
          },
          null,
          2
        )
      );
    });
  });

program
  .command("episode:generate")
  .description("Generate and download MiniMax music tracks for a planned episode")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--limit <count>", "Maximum number of tracks to generate in this run", parseInteger)
  .option("--track-index <index>", "Generate one track by 1-based index", parseInteger)
  .option("--dry-run", "Preview planned provider requests without calling MiniMax")
  .action(
    async (options: {
      episodeId: string;
      limit?: number;
      trackIndex?: number;
      dryRun?: boolean;
    }) => {
      await withDatabase(async ({ trackRepository }) => {
        const provider = buildMusicProvider(Boolean(options.dryRun));
        const service = new MusicGenerationService(trackRepository, provider, logger);
        const result = await service.generateEpisodeMusic({
          episodeId: options.episodeId,
          ...(options.limit ? { limit: options.limit } : {}),
          ...(options.trackIndex ? { trackIndex: options.trackIndex } : {}),
          dryRun: Boolean(options.dryRun)
        });

        console.log(JSON.stringify(result, null, 2));
      });
    }
  );

program
  .command("track:reset")
  .description("Reset one track to planned using the latest prompt template so it can be regenerated")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .requiredOption("--track-index <index>", "1-based track index to reset", parseInteger)
  .action(async (options: { episodeId: string; trackIndex: number }) => {
    await withDatabase(({ trackRepository }) => {
      const episode = trackRepository.getEpisode(options.episodeId);

      if (!episode) {
        throw new Error(`Episode not found: ${options.episodeId}`);
      }

      const series = findSeriesConfig(episode.seriesId);

      if (!series) {
        throw new Error(`Unknown series on episode: ${episode.seriesId}`);
      }

      const plan = buildEpisodePlan(series, episode.subtitle);
      const track = plan.tracks.find((plannedTrack) => plannedTrack.index === options.trackIndex);

      if (!track) {
        throw new Error(`Track index ${options.trackIndex} is outside this episode plan.`);
      }

      const result = trackRepository.resetTrackForRegeneration({
        episodeId: episode.id,
        trackIndex: track.index,
        title: track.title,
        role: track.role,
        durationTargetSeconds: track.durationTargetSeconds,
        prompt: track.prompt
      });

      console.log(
        JSON.stringify(
          {
            episodeId: episode.id,
            trackIndex: track.index,
            title: track.title,
            status: "planned",
            promptVersion: "lofi-focus-v5",
            previousStatus: result.previousStatus,
            previousFilePath: result.previousFilePath,
            note: "The previous audio file was not deleted. Running episode:generate for this track may overwrite the same target path."
          },
          null,
          2
        )
      );
    });
  });

program
  .command("audio:qc")
  .description("Run minimum audio QC checks for generated tracks")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--track-index <index>", "QC one track by 1-based index", parseInteger)
  .action(async (options: { episodeId: string; trackIndex?: number }) => {
    await withDatabase(async ({ trackRepository }) => {
      const service = new AudioQcService(trackRepository, logger);
      const result = await service.runEpisodeTrackQc({
        episodeId: options.episodeId,
        ...(options.trackIndex ? { trackIndex: options.trackIndex } : {})
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("audio:mix")
  .description("Combine QC-passed tracks into a normalized episode audio mix")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--allow-partial", "Allow a test mix before all episode tracks pass QC")
  .option("--crossfade-seconds <seconds>", "Crossfade duration between tracks", parsePositiveNumber)
  .option("--preview-seconds <seconds>", "Preview clip length", parsePositiveNumber)
  .action(
    async (options: {
      episodeId: string;
      allowPartial?: boolean;
      crossfadeSeconds?: number;
      previewSeconds?: number;
    }) => {
      await withDatabase(async ({ trackRepository, assetRepository }) => {
        const service = new AudioMixService(trackRepository, assetRepository, logger);
        const result = await service.mixEpisodeAudio({
          episodeId: options.episodeId,
          allowPartial: Boolean(options.allowPartial),
          ...(options.crossfadeSeconds ? { crossfadeSeconds: options.crossfadeSeconds } : {}),
          ...(options.previewSeconds ? { previewSeconds: options.previewSeconds } : {})
        });

        console.log(JSON.stringify(result, null, 2));
      });
    }
  );

program
  .command("image:generate")
  .description("Generate hero and thumbnail images for an episode")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--dry-run", "Preview prompts and output paths without calling OpenAI")
  .action(async (options: { episodeId: string; dryRun?: boolean }) => {
    await withDatabase(async ({ trackRepository, episodePlanRepository, assetRepository }) => {
      const provider = buildImageProvider(Boolean(options.dryRun));
      const service = new ImageGenerationService(
        trackRepository,
        episodePlanRepository,
        assetRepository,
        provider,
        logger
      );
      const result = await service.generateEpisodeImages({
        episodeId: options.episodeId,
        dryRun: Boolean(options.dryRun)
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("image:import-codex")
  .description("Import Codex-generated images into the episode image asset pipeline")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .requiredOption("--hero-path <path>", "Codex-generated hero/source image path")
  .requiredOption("--thumbnail-path <path>", "Codex-generated thumbnail/source image path")
  .option("--provider-label <label>", "Provider label stored in SQLite assets", "codex")
  .option("--model-label <label>", "Model label stored in SQLite assets", "gpt-image-2")
  .action(
    async (options: {
      episodeId: string;
      heroPath: string;
      thumbnailPath: string;
      providerLabel: string;
      modelLabel: string;
    }) => {
      await withDatabase(async ({ trackRepository, episodePlanRepository, assetRepository }) => {
        const provider = buildImageProvider(true);
        const service = new ImageGenerationService(
          trackRepository,
          episodePlanRepository,
          assetRepository,
          provider,
          logger
        );
        const result = await service.importCodexGeneratedImages({
          episodeId: options.episodeId,
          heroImagePath: options.heroPath,
          thumbnailImagePath: options.thumbnailPath,
          providerLabel: options.providerLabel,
          modelLabel: options.modelLabel
        });

        console.log(JSON.stringify(result, null, 2));
      });
    }
  );

program
  .command("youtube:package")
  .description("Create a manual-review YouTube publish package for an episode")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--video-path <path>", "Final rendered MP4 path")
  .option("--visibility <visibility>", "private, unlisted, or public", parseVisibility, "private")
  .option("--scheduled-publish-at <isoDate>", "Optional scheduled publish timestamp")
  .action(
    async (options: {
      episodeId: string;
      videoPath?: string;
      visibility: "private" | "unlisted" | "public";
      scheduledPublishAt?: string;
    }) => {
      await withDatabase(async ({
        publishPackageRepository,
        trackRepository,
        assetRepository
      }) => {
        const service = new YoutubePublishPackageService(
          publishPackageRepository,
          trackRepository,
          assetRepository,
          logger
        );
        const result = await service.createPackage({
          episodeId: options.episodeId,
          visibility: options.visibility,
          ...(options.videoPath ? { videoPath: options.videoPath } : {}),
          ...(options.scheduledPublishAt
            ? { scheduledPublishAt: options.scheduledPublishAt }
            : {})
        });

        console.log(JSON.stringify(result, null, 2));
      });
    }
  );

program
  .command("episode:approve")
  .description("Mark a reviewed episode as approved for upload")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--reviewer <name>", "Reviewer name", "manual")
  .option("--notes <notes>", "Optional approval notes")
  .action(async (options: { episodeId: string; reviewer: string; notes?: string }) => {
    await withDatabase(({ approvalRepository }) => {
      const service = new ApprovalService(approvalRepository, logger);
      const result = service.saveDecision({
        episodeId: options.episodeId,
        decision: "approved",
        reviewer: options.reviewer,
        ...(options.notes ? { notes: options.notes } : {})
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("episode:request-regenerate")
  .description("Mark a reviewed episode as requiring full regeneration")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--reviewer <name>", "Reviewer name", "manual")
  .option("--notes <notes>", "Regeneration reason")
  .action(async (options: { episodeId: string; reviewer: string; notes?: string }) => {
    await withDatabase(({ approvalRepository }) => {
      const service = new ApprovalService(approvalRepository, logger);
      const result = service.saveDecision({
        episodeId: options.episodeId,
        decision: "regenerate_requested",
        reviewer: options.reviewer,
        ...(options.notes ? { notes: options.notes } : {})
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("youtube:upload-check")
  .description("Verify the approval gate before upload automation is allowed to run")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .action(async (options: { episodeId: string }) => {
    await withDatabase(({ approvalRepository }) => {
      const service = new ApprovalService(approvalRepository, logger);
      const result = service.assertApprovedForUpload(options.episodeId);

      console.log(JSON.stringify({ ...result, uploadAllowed: true }, null, 2));
    });
  });

program
  .command("notion:schema")
  .description("Inspect the Notion dashboard database/data source schema")
  .action(async () => {
    await withDatabase(({ publishPackageRepository, assetRepository }) => {
      const service = new NotionSyncService(
        publishPackageRepository,
        assetRepository,
        buildNotionProvider(false),
        logger
      );

      return service.inspectSchema().then((result) => {
        console.log(JSON.stringify(result, null, 2));
      });
    });
  });

program
  .command("notion:ensure-schema")
  .description("Add missing Notion dashboard properties to the configured database/data source")
  .action(async () => {
    await withDatabase(({ publishPackageRepository, assetRepository }) => {
      const service = new NotionSyncService(
        publishPackageRepository,
        assetRepository,
        buildNotionProvider(true),
        logger
      );

      return service.ensureSchema().then((result) => {
        console.log(
          JSON.stringify(
            {
              target: {
                id: result.target.id,
                mode: result.target.mode,
                titlePropertyName: result.target.titlePropertyName
              },
              addedProperties: result.addedProperties
            },
            null,
            2
          )
        );
      });
    });
  });

program
  .command("notion:bootstrap")
  .description("Create the Notion dashboard database under the configured parent page")
  .option("--title <title>", "Dashboard database title", "Music Channel Dashboard")
  .action(async (options: { title: string }) => {
    const provider = buildNotionProvider(true);

    if (!provider || !config.NOTION_DATABASE_ID) {
      throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required for Notion bootstrap.");
    }

    const result = await provider.createDashboardDatabaseUnderPage({
      pageId: normalizeNotionObjectId(config.NOTION_DATABASE_ID),
      title: options.title
    });

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("notion:sync-with-data-source")
  .description("Create or update a Notion dashboard page using an explicit data source ID")
  .requiredOption("--data-source-id <id>", "Notion data source ID")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .action(async (options: { dataSourceId: string; episodeId: string }) => {
    await withDatabase(async ({ publishPackageRepository, assetRepository }) => {
      if (!config.NOTION_API_KEY) {
        throw new Error("NOTION_API_KEY is required for Notion sync.");
      }

      const service = new NotionSyncService(
        publishPackageRepository,
        assetRepository,
        new NotionDashboardProvider({
          apiKey: config.NOTION_API_KEY,
          databaseId: normalizeNotionObjectId(options.dataSourceId)
        }),
        logger
      );
      const result = await service.syncEpisode({
        episodeId: options.episodeId
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("notion:sync")
  .description("Create or update a Notion dashboard page for an episode")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--dry-run", "Preview the Notion page payload without calling Notion")
  .action(async (options: { episodeId: string; dryRun?: boolean }) => {
    await withDatabase(async ({ publishPackageRepository, assetRepository }) => {
      const service = new NotionSyncService(
        publishPackageRepository,
        assetRepository,
        buildNotionProvider(!options.dryRun),
        logger
      );
      const result = await service.syncEpisode({
        episodeId: options.episodeId,
        dryRun: Boolean(options.dryRun)
      });

      console.log(JSON.stringify(result, null, 2));
    });
  });

program
  .command("youtube:auth-url")
  .description("Generate the Google OAuth URL needed to obtain a YouTube refresh token")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .action((options: { channel?: string }) => {
    const provider = buildYouTubeProviderForAuth(options.channel);

    console.log(
      JSON.stringify(
        {
          channel: provider.targetChannel,
          authUrl: provider.createAuthUrl(),
          scope: youtubeAuthScopes
        },
        null,
        2
      )
    );
  });

program
  .command("youtube:exchange-code")
  .description("Exchange a Google OAuth code for a YouTube refresh token")
  .requiredOption("--code <code>", "Authorization code from Google OAuth redirect")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--write-env", "Write YOUTUBE_REFRESH_TOKEN into .env")
  .action(async (options: { code: string; channel?: string; writeEnv?: boolean }) => {
    const provider = buildYouTubeProviderForAuth(options.channel);
    const result = await provider.exchangeCode(options.code);

    if (options.writeEnv && result.refreshToken) {
      await upsertYouTubeRefreshToken(provider.targetChannel.key, result.refreshToken);
    }

    console.log(
      JSON.stringify(
        {
          channel: provider.targetChannel,
          hasRefreshToken: result.hasRefreshToken,
          wroteEnv: Boolean(options.writeEnv && result.refreshToken),
          expiryDate: result.expiryDate,
          note: result.refreshToken
            ? "Refresh token received."
            : "No refresh token returned. Re-run auth-url and make sure prompt=consent is used."
        },
        null,
        2
      )
    );
  });

program
  .command("youtube:upload")
  .description("Upload an approved episode to YouTube as private by default")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--dry-run", "Preview upload request without calling YouTube")
  .option("--visibility <visibility>", "private, unlisted, or public", parseVisibility, "private")
  .option("--notify-subscribers", "Notify subscribers on upload")
  .option("--skip-thumbnail", "Upload the video without setting a custom thumbnail")
  .option("--playlist-id <playlistId>", "Playlist ID to add the uploaded video to")
  .option("--skip-playlist", "Upload without adding the video to a playlist")
  .action(
    async (options: {
      episodeId: string;
      channel?: string;
      dryRun?: boolean;
      visibility: "private" | "unlisted" | "public";
      notifySubscribers?: boolean;
      skipThumbnail?: boolean;
      playlistId?: string;
      skipPlaylist?: boolean;
    }) => {
      await withDatabase(async ({
        publishPackageRepository,
        youtubeUploadRepository,
        trackRepository,
        approvalRepository,
        youtubePerformanceRepository
      }) => {
        const provider = buildYouTubeProvider(!options.dryRun, options.channel);
        const approvalService = new ApprovalService(approvalRepository, logger);
        const service = new YoutubeUploadService(
          publishPackageRepository,
          youtubeUploadRepository,
          trackRepository,
          approvalService,
          provider,
          logger
        );
        const result = await service.uploadEpisode({
          episodeId: options.episodeId,
          dryRun: Boolean(options.dryRun),
          visibility: options.visibility,
          notifySubscribers: Boolean(options.notifySubscribers),
          skipThumbnail: Boolean(options.skipThumbnail),
          ...(options.playlistId ? { playlistId: options.playlistId } : {}),
          skipPlaylist: Boolean(options.skipPlaylist)
        });

        if (!result.dryRun && result.youtubeVideoId && result.channel) {
          const tracking = await recordExperimentForEpisode({
            publishPackageRepository,
            youtubePerformanceRepository,
            episodeId: options.episodeId,
            youtubeVideoId: result.youtubeVideoId,
            channelKey: result.channel.key,
            thumbnailConcept: "orbital megastructure with clean focus typography",
            visualStyle: "clean NASA engineering space megastructure, tiny human scale",
            musicStyle: "space lofi coding ambient",
            hasTelemetryOverlay: true,
            hasPerTrackScenes: true
          });
          const videoStatus = result.postPublish?.videoStatus;
          const snapshot = videoStatus
            ? youtubePerformanceRepository.saveSnapshot(
                buildPerformanceSnapshotInput({
                  episodeId: options.episodeId,
                  channelKey: result.channel.key,
                  status: videoStatus
                })
              )
            : undefined;

          console.log(JSON.stringify({ ...result, performanceTracking: { ...tracking, snapshot } }, null, 2));
          return;
        }

        console.log(JSON.stringify(result, null, 2));
      });
    }
  );

program
  .command("youtube:status")
  .description("Read and store a YouTube video status snapshot")
  .option("--episode-id <episodeId>", "Episode ID used to find the latest uploaded YouTube video")
  .option("--video-id <videoId>", "Explicit YouTube video ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .action(async (options: { episodeId?: string; videoId?: string; channel?: string }) => {
    const provider = buildYouTubeProvider(true, options.channel);

    if (!provider) {
      throw new Error("YouTube OAuth credentials are required for youtube:status.");
    }

    const videoId = await resolveVideoIdForCli({
      ...(options.videoId ? { explicitVideoId: options.videoId } : {}),
      ...(options.episodeId ? { episodeId: options.episodeId } : {}),
      channelKey: provider.targetChannel.key
    });
    const status = await provider.getVideoStatus(videoId);

    if (options.episodeId) {
      await withDatabase(({ youtubeUploadRepository }) => {
        youtubeUploadRepository.saveUpload({
          episodeId: options.episodeId!,
          youtubeVideoId: videoId,
          channelKey: provider.targetChannel.key,
          visibility: status.privacyStatus ?? "unknown",
          status: "status_checked",
          metadata: {
            targetChannel: provider.targetChannel,
            videoStatus: status
          }
        });
      });
    }

    console.log(
      JSON.stringify(
        {
          channel: provider.targetChannel,
          videoStatus: status
        },
        null,
        2
      )
    );
  });

program
  .command("youtube:set-thumbnail")
  .description("Set or replace the thumbnail for an uploaded YouTube video")
  .option("--episode-id <episodeId>", "Episode ID used to find the latest uploaded YouTube video and thumbnail")
  .option("--video-id <videoId>", "Explicit YouTube video ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--thumbnail-path <path>", "Explicit thumbnail image path")
  .action(
    async (options: {
      episodeId?: string;
      videoId?: string;
      channel?: string;
      thumbnailPath?: string;
    }) => {
      const provider = buildYouTubeProvider(true, options.channel);

      if (!provider) {
        throw new Error("YouTube OAuth credentials are required for youtube:set-thumbnail.");
      }

      const videoId = await resolveVideoIdForCli({
        ...(options.videoId ? { explicitVideoId: options.videoId } : {}),
        ...(options.episodeId ? { episodeId: options.episodeId } : {}),
        channelKey: provider.targetChannel.key
      });
      const thumbnailPath =
        options.thumbnailPath ??
        (options.episodeId ? await resolveThumbnailPathForEpisode(options.episodeId) : undefined);

      if (!thumbnailPath) {
        throw new Error("Pass --thumbnail-path or provide --episode-id with a thumbnail_final asset.");
      }

      if (!existsSync(thumbnailPath)) {
        throw new Error(`Thumbnail is missing: ${thumbnailPath}`);
      }

      const result = await provider.setThumbnail({ videoId, thumbnailPath });

      if (options.episodeId) {
        await withDatabase(({ youtubeUploadRepository }) => {
          youtubeUploadRepository.saveUpload({
            episodeId: options.episodeId!,
            youtubeVideoId: videoId,
            channelKey: provider.targetChannel.key,
            visibility: "unknown",
            status: "thumbnail_set",
            metadata: {
              thumbnailPath,
              targetChannel: provider.targetChannel,
              result
            }
          });
        });
      }

      console.log(JSON.stringify({ ...result, thumbnailPath }, null, 2));
    }
  );

program
  .command("youtube:record-experiment")
  .description("Record creative packaging metadata for later YouTube performance analysis")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--video-id <videoId>", "Explicit YouTube video ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--thumbnail-concept <text>", "Short thumbnail concept label")
  .option("--visual-style <text>", "Short visual style label")
  .option("--music-style <text>", "Short music style label")
  .option("--no-telemetry-overlay", "Mark the video as not using telemetry overlay")
  .option("--no-per-track-scenes", "Mark the video as not using per-track scenes")
  .action(
    async (options: {
      episodeId: string;
      videoId?: string;
      channel?: string;
      thumbnailConcept?: string;
      visualStyle?: string;
      musicStyle?: string;
      telemetryOverlay?: boolean;
      perTrackScenes?: boolean;
    }) => {
      const provider = buildYouTubeProvider(false, options.channel);
      const channelKey = provider?.targetChannel.key ?? options.channel ?? config.YOUTUBE_ACTIVE_CHANNEL;
      const videoId = await resolveVideoIdForCli({
        ...(options.videoId ? { explicitVideoId: options.videoId } : {}),
        episodeId: options.episodeId,
        channelKey
      });

      const result = await withDatabase(({ publishPackageRepository, youtubePerformanceRepository }) =>
        recordExperimentForEpisode({
          publishPackageRepository,
          youtubePerformanceRepository,
          episodeId: options.episodeId,
          youtubeVideoId: videoId,
          channelKey,
          thumbnailConcept: options.thumbnailConcept ?? "orbital megastructure with clean focus typography",
          visualStyle:
            options.visualStyle ?? "clean NASA engineering space megastructure, tiny human scale",
          musicStyle: options.musicStyle ?? "space lofi coding ambient",
          hasTelemetryOverlay: options.telemetryOverlay ?? true,
          hasPerTrackScenes: options.perTrackScenes ?? true
        })
      );

      console.log(JSON.stringify(result, null, 2));
    }
  );

program
  .command("youtube:track-performance")
  .description("Capture a YouTube Data API performance snapshot for an uploaded video")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--video-id <videoId>", "Explicit YouTube video ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .action(async (options: { episodeId: string; videoId?: string; channel?: string }) => {
    const provider = buildYouTubeProvider(true, options.channel);

    if (!provider) {
      throw new Error("YouTube OAuth credentials are required for youtube:track-performance.");
    }

    const videoId = await resolveVideoIdForCli({
      ...(options.videoId ? { explicitVideoId: options.videoId } : {}),
      episodeId: options.episodeId,
      channelKey: provider.targetChannel.key
    });
    const status = await provider.getVideoStatus(videoId);

    const snapshot = await withDatabase(({ youtubePerformanceRepository }) =>
      youtubePerformanceRepository.saveSnapshot(
        buildPerformanceSnapshotInput({
          episodeId: options.episodeId,
          channelKey: provider.targetChannel.key,
          status
        })
      )
    );

    console.log(
      JSON.stringify(
        {
          episodeId: options.episodeId,
          channel: provider.targetChannel,
          snapshot,
          videoStatus: status
        },
        null,
        2
      )
    );
  });

program
  .command("youtube:track-all-performance")
  .description("Capture YouTube performance snapshots for all uploaded videos in a channel")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--series <seriesName>", "Only track uploaded videos whose episode belongs to this series")
  .option("--limit <count>", "Maximum number of uploaded episode videos to track", parsePositiveInteger)
  .action(async (options: { channel?: string; series?: string; limit?: number }) => {
    const provider = buildYouTubeProvider(true, options.channel);

    if (!provider) {
      throw new Error("YouTube OAuth credentials are required for youtube:track-all-performance.");
    }

    const uploads = await withDatabase(({ youtubeUploadRepository, publishPackageRepository }) => {
      const candidates = youtubeUploadRepository.listLatestUploadedVideos({
        channelKey: provider.targetChannel.key,
        ...(options.limit ? { limit: options.limit } : {})
      });

      if (!options.series) {
        return candidates;
      }

      return candidates.filter((upload) => {
        const episode = publishPackageRepository.getEpisode(upload.episodeId);

        return episode?.plan.seriesName === options.series || episode?.seriesId === options.series;
      });
    });
    const results: Array<Record<string, unknown>> = [];

    for (const upload of uploads) {
      try {
        const status = await provider.getVideoStatus(upload.youtubeVideoId);
        const snapshot = await withDatabase(({ youtubePerformanceRepository }) =>
          youtubePerformanceRepository.saveSnapshot(
            buildPerformanceSnapshotInput({
              episodeId: upload.episodeId,
              channelKey: provider.targetChannel.key,
              status
            })
          )
        );

        results.push({
          episodeId: upload.episodeId,
          youtubeVideoId: upload.youtubeVideoId,
          ok: true,
          snapshot,
          viewCount: status.viewCount,
          likeCount: status.likeCount,
          commentCount: status.commentCount,
          processingStatus: status.processingStatus
        });
      } catch (error) {
        results.push({
          episodeId: upload.episodeId,
          youtubeVideoId: upload.youtubeVideoId,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(
      JSON.stringify(
        {
          channel: provider.targetChannel,
          tracked: results.filter((result) => result.ok).length,
          failed: results.filter((result) => !result.ok).length,
          results
        },
        null,
        2
      )
    );
  });

program
  .command("youtube:performance-report")
  .description("Print stored YouTube performance snapshots and creative metadata")
  .requiredOption("--episode-id <episodeId>", "Episode ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .action(async (options: { episodeId: string; channel?: string }) => {
    const provider = buildYouTubeProvider(false, options.channel);
    const channelKey = provider?.targetChannel.key ?? options.channel ?? config.YOUTUBE_ACTIVE_CHANNEL;
    const report = await withDatabase(({ youtubePerformanceRepository }) =>
      youtubePerformanceRepository.getPerformanceReport({
        episodeId: options.episodeId,
        channelKey
      })
    );

    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("youtube:add-to-playlist")
  .description("Add an uploaded YouTube video to a playlist")
  .option("--episode-id <episodeId>", "Episode ID used to find the latest uploaded YouTube video and publish package")
  .option("--video-id <videoId>", "Explicit YouTube video ID")
  .option("--channel <channelKey>", "YouTube channel profile key")
  .option("--playlist-id <playlistId>", "Explicit playlist ID")
  .option("--position <position>", "Optional zero-based playlist position", parseNonNegativeInteger)
  .option("--dry-run", "Preview playlist insertion without calling YouTube")
  .action(
    async (options: {
      episodeId?: string;
      videoId?: string;
      channel?: string;
      playlistId?: string;
      position?: number;
      dryRun?: boolean;
    }) => {
      const provider = buildYouTubeProvider(!options.dryRun, options.channel);
      const videoId = await resolveVideoIdForCli({
        ...(options.videoId ? { explicitVideoId: options.videoId } : {}),
        ...(options.episodeId ? { episodeId: options.episodeId } : {}),
        channelKey: provider?.targetChannel.key ?? config.YOUTUBE_ACTIVE_CHANNEL
      });
      const publishPackage = options.episodeId
        ? await readPublishPackageForEpisode(options.episodeId)
        : undefined;
      const playlistTarget = resolveYouTubePlaylistTarget({
        ...(publishPackage ? { publishPackage } : {}),
        ...(provider ? { targetChannel: provider.targetChannel } : {}),
        ...(options.playlistId ? { explicitPlaylistId: options.playlistId } : {})
      });

      if (!playlistTarget) {
        throw new Error(
          "No playlist ID resolved. Pass --playlist-id or configure defaultPlaylistId/playlists in YOUTUBE_CHANNELS_JSON."
        );
      }

      if (options.dryRun) {
        console.log(
          JSON.stringify(
            {
              dryRun: true,
              channel: provider?.targetChannel,
              videoId,
              playlistTarget,
              position: options.position ?? null
            },
            null,
            2
          )
        );
        return;
      }

      if (!provider) {
        throw new Error("YouTube OAuth credentials are required for youtube:add-to-playlist.");
      }

      const result = await provider.addVideoToPlaylist({
        videoId,
        playlistId: playlistTarget.playlistId,
        ...(options.position !== undefined ? { position: options.position } : {})
      });

      if (options.episodeId) {
        await withDatabase(({ youtubeUploadRepository }) => {
          youtubeUploadRepository.saveUpload({
            episodeId: options.episodeId!,
            youtubeVideoId: videoId,
            channelKey: provider.targetChannel.key,
            visibility: "unknown",
            status: "playlist_added",
            metadata: {
              targetChannel: provider.targetChannel,
              playlistTarget,
              playlistItem: result
            }
          });
        });
      }

      console.log(JSON.stringify(result, null, 2));
    }
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error({ error }, message);
  process.exitCode = 1;
});

function parseInteger(value: string) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received "${value}".`);
  }

  return parsed;
}

async function resolveVideoIdForCli(input: {
  explicitVideoId?: string;
  episodeId?: string;
  channelKey: string;
}) {
  if (input.explicitVideoId) {
    return input.explicitVideoId;
  }

  if (!input.episodeId) {
    throw new Error("Pass either --video-id or --episode-id.");
  }

  return withDatabase(({ youtubeUploadRepository }) => {
    const upload = youtubeUploadRepository.findLatestWithVideoId(input.episodeId!, input.channelKey);

    if (!upload?.youtubeVideoId) {
      throw new Error(`No uploaded YouTube video record found for episode ${input.episodeId}.`);
    }

    return upload.youtubeVideoId;
  });
}

async function readPublishPackageForEpisode(episodeId: string) {
  return withDatabase(async ({ publishPackageRepository }) => {
    const assets = publishPackageRepository.listAssets(episodeId);
    const packageAsset = assets.find((asset) => asset.assetType === "youtube_publish_package");
    const jsonPath = packageAsset?.metadata.jsonPath;

    if (typeof jsonPath !== "string") {
      return undefined;
    }

    const content = await readFile(jsonPath, "utf8");

    return JSON.parse(content) as {
      series?: string;
      playlistId?: string;
      playlist?: {
        id?: string;
        name?: string;
      };
    };
  });
}

async function readFullPublishPackageFromRepository(
  publishPackageRepository: PublishPackageRepository,
  episodeId: string
) {
  const assets = publishPackageRepository.listAssets(episodeId);
  const packageAsset = assets.find((asset) => asset.assetType === "youtube_publish_package");
  const jsonPath = packageAsset?.metadata.jsonPath;

  if (typeof jsonPath !== "string") {
    return undefined;
  }

  const content = await readFile(jsonPath, "utf8");

  return {
    ...(JSON.parse(content) as Record<string, unknown>),
    _jsonPath: jsonPath
  };
}

async function readFullPublishPackageForEpisode(episodeId: string) {
  return withDatabase(async ({ publishPackageRepository }) => {
    return readFullPublishPackageFromRepository(publishPackageRepository, episodeId);
  });
}

async function recordExperimentForEpisode(input: {
  publishPackageRepository: PublishPackageRepository;
  youtubePerformanceRepository: YoutubePerformanceRepository;
  episodeId: string;
  youtubeVideoId: string;
  channelKey: string;
  thumbnailConcept: string;
  visualStyle: string;
  musicStyle: string;
  hasTelemetryOverlay: boolean;
  hasPerTrackScenes: boolean;
}) {
  const episode = input.publishPackageRepository.getEpisode(input.episodeId);

  if (!episode) {
    throw new Error(`Episode not found: ${input.episodeId}`);
  }

  const tracks = input.publishPackageRepository.listTracks(input.episodeId);
  const assets = input.publishPackageRepository.listAssets(input.episodeId);
  const publishPackage = await readFullPublishPackageFromRepository(
    input.publishPackageRepository,
    input.episodeId
  );
  const thumbnail = [...assets].reverse().find((asset) => asset.assetType === "thumbnail_final");
  const thumbnailPath =
    thumbnail?.filePath ?? readNestedString(publishPackage, ["assets", "thumbnailPath"]);
  const durationSeconds =
    readNestedNumber(publishPackage, ["durationSeconds"]) ??
    readNestedNumber(publishPackage, ["videoProbe", "durationSeconds"]);

  const saved = input.youtubePerformanceRepository.upsertExperiment({
    episodeId: episode.id,
    youtubeVideoId: input.youtubeVideoId,
    channelKey: input.channelKey,
    series: readNestedString(publishPackage, ["series"]) ?? episode.plan.seriesName,
    title: readNestedString(publishPackage, ["title"]) ?? episode.title,
    ...(thumbnailPath ? { thumbnailPath } : {}),
    thumbnailConcept: input.thumbnailConcept,
    visualStyle: input.visualStyle,
    musicStyle: input.musicStyle,
    ...(durationSeconds ? { durationSeconds } : {}),
    trackCount: tracks.length,
    hasTelemetryOverlay: input.hasTelemetryOverlay,
    hasPerTrackScenes: input.hasPerTrackScenes,
    metadata: {
      publishPackagePath: readNestedString(publishPackage, ["_jsonPath"]),
      thumbnailAssetId: thumbnail?.id,
      assetTypes: assets.map((asset) => asset.assetType),
      trackTitles: tracks.map((track) => track.title)
    }
  });

  return {
    ...saved,
    episodeId: episode.id,
    youtubeVideoId: input.youtubeVideoId,
    channelKey: input.channelKey,
    thumbnailPath,
    trackCount: tracks.length
  };
}

function buildPerformanceSnapshotInput(input: {
  episodeId: string;
  channelKey: string;
  status: Awaited<ReturnType<YouTubeUploadProvider["getVideoStatus"]>>;
}) {
  return {
    episodeId: input.episodeId,
    youtubeVideoId: input.status.videoId,
    channelKey: input.channelKey,
    ...(input.status.privacyStatus ? { privacyStatus: input.status.privacyStatus } : {}),
    ...(input.status.uploadStatus ? { uploadStatus: input.status.uploadStatus } : {}),
    ...(input.status.processingStatus ? { processingStatus: input.status.processingStatus } : {}),
    ...(input.status.duration ? { duration: input.status.duration } : {}),
    viewCount: numberFromYouTubeCount(input.status.viewCount),
    likeCount: numberFromYouTubeCount(input.status.likeCount),
    commentCount: numberFromYouTubeCount(input.status.commentCount),
    favoriteCount: numberFromYouTubeCount(input.status.favoriteCount),
    raw: input.status
  };
}

async function resolveThumbnailPathForEpisode(episodeId: string) {
  return withDatabase(({ publishPackageRepository }) => {
    const assets = publishPackageRepository.listAssets(episodeId);
    const thumbnail = [...assets].reverse().find((asset) => asset.assetType === "thumbnail_final");

    return thumbnail?.filePath;
  });
}

function readNestedString(value: unknown, path: string[]) {
  const result = readNestedValue(value, path);

  return typeof result === "string" && result.trim().length > 0 ? result : undefined;
}

function readNestedNumber(value: unknown, path: string[]) {
  const result = readNestedValue(value, path);

  return typeof result === "number" && Number.isFinite(result) ? result : undefined;
}

function readNestedValue(value: unknown, path: string[]) {
  let current = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function numberFromYouTubeCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePositiveNumber(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, received "${value}".`);
  }

  return parsed;
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}

function parseVisibility(value: string) {
  if (value !== "private" && value !== "unlisted" && value !== "public") {
    throw new Error(`Expected visibility to be private, unlisted, or public. Received "${value}".`);
  }

  return value;
}

function buildMusicProvider(isDryRun: boolean) {
  if (!config.MINIMAX_API_KEY && !isDryRun) {
    throw new Error("MINIMAX_API_KEY is required to generate music. Use --dry-run to preview.");
  }

  return new MinimaxMusicProvider({
    apiKey: config.MINIMAX_API_KEY ?? "dry-run",
    baseUrl: config.MINIMAX_BASE_URL,
    model: config.MINIMAX_MUSIC_MODEL
  });
}

function buildImageProvider(isDryRun: boolean) {
  if (!config.OPENAI_API_KEY && !isDryRun) {
    throw new Error("OPENAI_API_KEY is required to generate images. Use --dry-run to preview.");
  }

  return new OpenAIImageProvider({
    apiKey: config.OPENAI_API_KEY ?? "dry-run",
    model: config.OPENAI_IMAGE_MODEL,
    size: config.OPENAI_IMAGE_SIZE,
    quality: config.OPENAI_IMAGE_QUALITY,
    outputFormat: config.OPENAI_IMAGE_FORMAT
  });
}

function buildNotionProvider(isRequired: boolean) {
  if (!config.NOTION_API_KEY || !config.NOTION_DATABASE_ID) {
    if (isRequired) {
      throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required for Notion sync.");
    }

    return undefined;
  }

  return new NotionDashboardProvider({
    apiKey: config.NOTION_API_KEY,
    databaseId: normalizeNotionObjectId(config.NOTION_DATABASE_ID)
  });
}

function buildYouTubeProvider(isRequired: boolean, channelKey?: string) {
  const profile = resolveYouTubeChannelProfile(channelKey, isRequired);

  if (!profile?.clientId || !profile.clientSecret || (isRequired && !profile.refreshToken)) {
    if (isRequired) {
      throw new Error(
        `YouTube channel "${channelKey ?? config.YOUTUBE_ACTIVE_CHANNEL}" requires clientId, clientSecret, and refreshToken.`
      );
    }

    return undefined;
  }

  return new YouTubeUploadProvider({
    clientId: profile.clientId,
    clientSecret: profile.clientSecret,
    ...(profile.refreshToken ? { refreshToken: profile.refreshToken } : {}),
    redirectUri: profile.redirectUri,
    channelKey: profile.key,
    ...(profile.name ? { channelName: profile.name } : {}),
    ...(profile.channelId ? { channelId: profile.channelId } : {}),
    ...(profile.defaultPlaylistId ? { defaultPlaylistId: profile.defaultPlaylistId } : {}),
    playlists: profile.playlists
  });
}

function buildYouTubeProviderForAuth(channelKey?: string) {
  const profile = resolveYouTubeChannelProfile(channelKey, true);

  if (!profile?.clientId || !profile.clientSecret) {
    throw new Error(`YouTube channel "${channelKey ?? config.YOUTUBE_ACTIVE_CHANNEL}" requires clientId and clientSecret for OAuth.`);
  }

  return new YouTubeUploadProvider({
    clientId: profile.clientId,
    clientSecret: profile.clientSecret,
    redirectUri: profile.redirectUri,
    channelKey: profile.key,
    ...(profile.name ? { channelName: profile.name } : {}),
    ...(profile.channelId ? { channelId: profile.channelId } : {}),
    ...(profile.defaultPlaylistId ? { defaultPlaylistId: profile.defaultPlaylistId } : {}),
    playlists: profile.playlists
  });
}

function resolveYouTubeChannelProfile(channelKey: string | undefined, isRequired: boolean) {
  const key = channelKey ?? config.YOUTUBE_ACTIVE_CHANNEL;
  const profile = config.youtubeChannelProfiles.get(key);

  if (profile) {
    return profile;
  }

  if (config.YOUTUBE_CLIENT_ID && config.YOUTUBE_CLIENT_SECRET) {
    return {
      key,
      clientId: config.YOUTUBE_CLIENT_ID,
      clientSecret: config.YOUTUBE_CLIENT_SECRET,
      redirectUri: config.YOUTUBE_REDIRECT_URI,
      playlists: {}
    };
  }

  if (isRequired) {
    throw new Error(`Unknown YouTube channel profile "${key}". Add it to YOUTUBE_CHANNELS_JSON or use legacy YOUTUBE_* credentials.`);
  }

  return undefined;
}

async function upsertEnvValue(key: string, value: string) {
  const { readFile, writeFile } = await import("node:fs/promises");
  const envPath = ".env";
  const content = await readFile(envPath, "utf8");
  const escapedValue = value.replace(/\r?\n/g, "");
  const line = `${key}=${escapedValue}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const nextContent = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;

  await writeFile(envPath, nextContent, "utf8");
}

async function upsertYouTubeRefreshToken(channelKey: string, refreshToken: string) {
  if (channelKey === "default" && !process.env.YOUTUBE_CHANNELS_JSON) {
    await upsertEnvValue("YOUTUBE_REFRESH_TOKEN", refreshToken);
    return;
  }

  const profile = resolveYouTubeChannelProfile(channelKey, true);
  const channels = parseEnvYouTubeChannelsJson();
  channels[channelKey] = {
    ...(channels[channelKey] ?? {}),
    ...(profile?.name ? { name: profile.name } : {}),
    ...(profile?.channelId ? { channelId: profile.channelId } : {}),
    ...(profile?.clientId ? { clientId: profile.clientId } : {}),
    ...(profile?.clientSecret ? { clientSecret: profile.clientSecret } : {}),
    ...(profile?.redirectUri && profile.redirectUri !== config.YOUTUBE_REDIRECT_URI
      ? { redirectUri: profile.redirectUri }
      : {}),
    refreshToken
  };

  await upsertEnvValue("YOUTUBE_CHANNELS_JSON", JSON.stringify(channels));
}

function parseEnvYouTubeChannelsJson() {
  if (!process.env.YOUTUBE_CHANNELS_JSON) {
    return {} as Record<string, Record<string, unknown>>;
  }

  const parsed = JSON.parse(process.env.YOUTUBE_CHANNELS_JSON) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YOUTUBE_CHANNELS_JSON must be a JSON object.");
  }

  return parsed as Record<string, Record<string, unknown>>;
}

function normalizeNotionObjectId(value: string) {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  const hyphenatedUuid = trimmed.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);

  if (hyphenatedUuid) {
    return hyphenatedUuid[0].toLowerCase();
  }

  const compactUuidMatches = trimmed.match(/[0-9a-fA-F]{32}/g);
  const compactUuid = compactUuidMatches?.at(-1);

  if (!compactUuid) {
    return trimmed;
  }

  return [
    compactUuid.slice(0, 8),
    compactUuid.slice(8, 12),
    compactUuid.slice(12, 16),
    compactUuid.slice(16, 20),
    compactUuid.slice(20)
  ]
    .join("-")
    .toLowerCase();
}
