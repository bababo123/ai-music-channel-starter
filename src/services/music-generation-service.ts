import { join } from "node:path";
import type pino from "pino";
import type { MusicProvider } from "../domain/music-provider";
import type { PlannedTrackRow, TrackRepository } from "../repositories/track-repository";
import { slugify } from "../utils/slug";
import { nowIso } from "../utils/time";

export type GenerateEpisodeMusicOptions = {
  episodeId: string;
  limit?: number;
  trackIndex?: number;
  dryRun?: boolean;
};

export class MusicGenerationService {
  constructor(
    private readonly trackRepository: TrackRepository,
    private readonly musicProvider: MusicProvider,
    private readonly logger: pino.Logger
  ) {}

  async generateEpisodeMusic(options: GenerateEpisodeMusicOptions) {
    const episode = this.trackRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const pendingTracks = this.trackRepository
      .listPendingTracks(options.episodeId, options.trackIndex)
      .slice(0, options.limit);

    if (pendingTracks.length === 0) {
      return {
        episodeId: options.episodeId,
        generated: 0,
        dryRun: Boolean(options.dryRun),
        statusCounts: this.trackRepository.countTracksByStatus(options.episodeId)
      };
    }

    if (options.dryRun) {
      return {
        episodeId: options.episodeId,
        generated: 0,
        dryRun: true,
        planned: pendingTracks.map((track) => ({
          trackIndex: track.trackIndex,
          title: track.title,
          promptLength: track.prompt.length,
          outputPath: this.buildTrackOutputPath(episode.outputDir, track)
        })),
        statusCounts: this.trackRepository.countTracksByStatus(options.episodeId)
      };
    }

    this.trackRepository.markEpisodeStatus(options.episodeId, "music_generating");

    let generated = 0;

    for (const track of pendingTracks) {
      const outputPath = this.buildTrackOutputPath(episode.outputDir, track);
      const startedAt = nowIso();
      const baseMetadata = {
        ...track.metadata,
        provider: this.musicProvider.id,
        model: this.musicProvider.model,
        startedAt,
        outputPath
      };

      try {
        this.trackRepository.markTrackGenerating(track.id, baseMetadata);
        this.logger.info(
          { episodeId: options.episodeId, trackIndex: track.trackIndex, title: track.title },
          "Generating MiniMax music track"
        );

        const result = await this.musicProvider.generateTrack({
          prompt: track.prompt,
          outputPath,
          trackTitle: track.title,
          trackIndex: track.trackIndex
        });

        this.trackRepository.markTrackReady(track.id, result, {
          ...baseMetadata,
          completedAt: nowIso(),
          sha256: result.sha256,
          sizeBytes: result.sizeBytes,
          rawResponse: result.rawResponse
        });
        generated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.trackRepository.markTrackFailed(track.id, {
          ...baseMetadata,
          failedAt: nowIso(),
          error: message
        });
        this.logger.error(
          { episodeId: options.episodeId, trackIndex: track.trackIndex, error },
          "MiniMax music generation failed"
        );
        throw error;
      }
    }

    const statusCounts = this.trackRepository.countTracksByStatus(options.episodeId);

    const totalTracks = Object.values(statusCounts).reduce((total, count) => total + count, 0);

    if (statusCounts.music_ready === totalTracks) {
      this.trackRepository.markEpisodeStatus(options.episodeId, "music_ready");
    } else if (statusCounts.planned || statusCounts.music_failed) {
      this.trackRepository.markEpisodeStatus(options.episodeId, "planned");
    }

    return {
      episodeId: options.episodeId,
      generated,
      dryRun: false,
      statusCounts
    };
  }

  private buildTrackOutputPath(outputDir: string, track: PlannedTrackRow) {
    const filename = `${track.trackIndex.toString().padStart(2, "0")}-${slugify(
      track.title
    )}.mp3`;

    return join(outputDir, "audio", "tracks", filename);
  }
}
