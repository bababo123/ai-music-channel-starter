import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type pino from "pino";
import type { YouTubeUploadProvider } from "../providers/youtube-upload-provider";
import type { YouTubeTargetChannel } from "../providers/youtube-upload-provider";
import type { ApprovalService } from "./approval-service";
import type {
  PublishAssetRow,
  PublishPackageRepository
} from "../repositories/publish-package-repository";
import type { TrackRepository } from "../repositories/track-repository";
import type { YoutubeUploadRepository } from "../repositories/youtube-upload-repository";

export type YoutubeUploadOptions = {
  episodeId: string;
  dryRun?: boolean;
  visibility?: "private" | "unlisted" | "public";
  notifySubscribers?: boolean;
  skipThumbnail?: boolean;
  playlistId?: string;
  skipPlaylist?: boolean;
};

type PublishPackageJson = {
  series?: string;
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: "private" | "unlisted" | "public";
  scheduledPublishAt?: string;
  playlistId?: string;
  playlist?: {
    id?: string;
    name?: string;
  };
  assets?: {
    videoPath?: string;
    thumbnailPath?: string;
  };
};

export type YoutubePlaylistTarget = {
  playlistId: string;
  source: "option" | "publishPackage" | "seriesProfile" | "defaultProfile";
  series?: string;
};

export class YoutubeUploadService {
  constructor(
    private readonly publishRepository: PublishPackageRepository,
    private readonly uploadRepository: YoutubeUploadRepository,
    private readonly trackRepository: TrackRepository,
    private readonly approvalService: ApprovalService,
    private readonly provider: YouTubeUploadProvider | undefined,
    private readonly logger: pino.Logger
  ) {}

  async uploadEpisode(options: YoutubeUploadOptions) {
    const approval = this.approvalService.assertApprovedForUpload(options.episodeId);
    const episode = this.publishRepository.getEpisode(options.episodeId);

    if (!episode) {
      throw new Error(`Episode not found: ${options.episodeId}`);
    }

    const assets = this.publishRepository.listAssets(episode.id);
    const packageAsset = assets.find((asset) => asset.assetType === "youtube_publish_package");

    if (!packageAsset) {
      throw new Error(`Episode ${episode.id} does not have a YouTube publish package.`);
    }

    const publishPackage = await readPublishPackage(packageAsset);
    const uploadInput = buildUploadInput({
      packageAsset,
      publishPackage,
      visibility: options.visibility ?? publishPackage.visibility ?? "private",
      notifySubscribers: Boolean(options.notifySubscribers),
      skipThumbnail: Boolean(options.skipThumbnail)
    });
    const playlistTarget = resolveYouTubePlaylistTarget({
      publishPackage,
      ...(this.provider ? { targetChannel: this.provider.targetChannel } : {}),
      ...(options.playlistId ? { explicitPlaylistId: options.playlistId } : {}),
      skipPlaylist: Boolean(options.skipPlaylist)
    });

    if (options.dryRun) {
      return {
        episodeId: episode.id,
        dryRun: true,
        approvedStatus: approval.status,
        targetChannel: this.provider?.targetChannel,
        playlistTarget,
        uploadInput: {
          ...uploadInput,
          videoPath: uploadInput.videoPath,
          thumbnailPath: uploadInput.thumbnailPath
        }
      };
    }

    if (!this.provider) {
      throw new Error("YouTube OAuth credentials are required. Use --dry-run to preview.");
    }

    this.trackRepository.markEpisodeStatus(episode.id, "uploading");
    this.uploadRepository.saveUpload({
      episodeId: episode.id,
      channelKey: this.provider.targetChannel.key,
      visibility: uploadInput.privacyStatus,
      status: "uploading",
      ...(uploadInput.publishAt ? { scheduledPublishAt: uploadInput.publishAt } : {}),
      metadata: {
        title: uploadInput.title,
        videoPath: uploadInput.videoPath,
        thumbnailPath: uploadInput.thumbnailPath,
        targetChannel: this.provider?.targetChannel
      }
    });
    this.logger.info({ episodeId: episode.id }, "Uploading video to YouTube");
    const result = await this.uploadOrMarkFailed(episode.id, uploadInput);
    const status = uploadInput.publishAt ? "scheduled" : "uploaded";
    const postPublish = await this.runPostPublishManagement({
      videoId: result.videoId,
      ...(playlistTarget ? { playlistTarget } : {})
    });

    this.uploadRepository.saveUpload({
      episodeId: episode.id,
      youtubeVideoId: result.videoId,
      channelKey: result.channel.key,
      visibility: result.privacyStatus,
      status,
      ...(uploadInput.publishAt ? { scheduledPublishAt: uploadInput.publishAt } : {}),
      metadata: {
        url: result.url,
        thumbnailSet: result.thumbnailSet,
        thumbnailError: result.thumbnailError,
        title: uploadInput.title,
        categoryId: uploadInput.categoryId,
        containsSyntheticMedia: uploadInput.containsSyntheticMedia,
        targetChannel: result.channel,
        playlistTarget,
        postPublish
      }
    });
    this.trackRepository.markEpisodeStatus(episode.id, status);

    return {
      episodeId: episode.id,
      dryRun: false,
      status,
      youtubeVideoId: result.videoId,
      youtubeUrl: result.url,
      thumbnailSet: result.thumbnailSet,
      channel: result.channel,
      playlistTarget,
      postPublish
    };
  }

  private async runPostPublishManagement(input: {
    videoId: string;
    playlistTarget?: YoutubePlaylistTarget;
  }) {
    const result: {
      videoStatus?: Awaited<ReturnType<YouTubeUploadProvider["getVideoStatus"]>>;
      videoStatusError?: string;
      playlistItem?: Awaited<ReturnType<YouTubeUploadProvider["addVideoToPlaylist"]>>;
      playlistError?: string;
    } = {};

    if (!this.provider) {
      return result;
    }

    try {
      result.videoStatus = await this.provider.getVideoStatus(input.videoId);
    } catch (error) {
      result.videoStatusError = errorMessage(error);
      this.logger.warn({ error, videoId: input.videoId }, "Could not read YouTube video status");
    }

    if (!input.playlistTarget) {
      return result;
    }

    try {
      result.playlistItem = await this.provider.addVideoToPlaylist({
        videoId: input.videoId,
        playlistId: input.playlistTarget.playlistId
      });
    } catch (error) {
      result.playlistError = errorMessage(error);
      this.logger.warn(
        { error, videoId: input.videoId, playlistId: input.playlistTarget.playlistId },
        "Could not add YouTube video to playlist"
      );
    }

    return result;
  }

  private async uploadOrMarkFailed(
    episodeId: string,
    uploadInput: Parameters<YouTubeUploadProvider["uploadVideo"]>[0]
  ) {
    if (!this.provider) {
      throw new Error("YouTube OAuth credentials are required. Use --dry-run to preview.");
    }

    try {
      return await this.provider.uploadVideo(uploadInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.uploadRepository.saveUpload({
        episodeId,
        channelKey: this.provider.targetChannel.key,
        visibility: uploadInput.privacyStatus,
        status: "failed",
        ...(uploadInput.publishAt ? { scheduledPublishAt: uploadInput.publishAt } : {}),
        metadata: {
          title: uploadInput.title,
          videoPath: uploadInput.videoPath,
          thumbnailPath: uploadInput.thumbnailPath,
          error: message
        }
      });
      this.trackRepository.markEpisodeStatus(episodeId, "failed");

      throw error;
    }
  }
}

async function readPublishPackage(packageAsset: PublishAssetRow): Promise<PublishPackageJson> {
  const jsonPath = packageAsset.metadata.jsonPath;

  if (typeof jsonPath !== "string") {
    throw new Error("Publish package asset does not include metadata.jsonPath.");
  }

  const content = await readFile(jsonPath, "utf8");

  return JSON.parse(content) as PublishPackageJson;
}

function buildUploadInput(input: {
  packageAsset: PublishAssetRow;
  publishPackage: PublishPackageJson;
  visibility: "private" | "unlisted" | "public";
  notifySubscribers: boolean;
  skipThumbnail: boolean;
}) {
  const videoPath = input.publishPackage.assets?.videoPath;
  const thumbnailPath = input.skipThumbnail ? undefined : input.publishPackage.assets?.thumbnailPath;
  const title = input.publishPackage.title;
  const description = input.publishPackage.description;

  if (!videoPath || !existsSync(videoPath)) {
    throw new Error(`Final video is missing: ${videoPath ?? "not set"}`);
  }

  if (thumbnailPath) {
    if (!existsSync(thumbnailPath)) {
      throw new Error(`Thumbnail is missing: ${thumbnailPath}`);
    }

    const thumbnailBytes = statSync(thumbnailPath).size;

    if (thumbnailBytes > 2 * 1024 * 1024) {
      throw new Error(
        `Thumbnail is ${thumbnailBytes} bytes, over YouTube's 2MB API limit. Compress it before upload.`
      );
    }
  }

  if (!title) {
    throw new Error("Publish package does not include a YouTube title.");
  }

  if (!description) {
    throw new Error("Publish package does not include a YouTube description.");
  }

  return {
    videoPath,
    ...(thumbnailPath ? { thumbnailPath } : {}),
    title: title.slice(0, 100),
    description: description.slice(0, 5000),
    tags: (input.publishPackage.tags ?? []).slice(0, 30),
    privacyStatus: input.visibility,
    categoryId: "10",
    ...(input.publishPackage.scheduledPublishAt ? { publishAt: input.publishPackage.scheduledPublishAt } : {}),
    notifySubscribers: input.notifySubscribers,
    containsSyntheticMedia: true,
    selfDeclaredMadeForKids: false
  };
}

export function resolveYouTubePlaylistTarget(input: {
  publishPackage?: PublishPackageJson;
  targetChannel?: YouTubeTargetChannel;
  explicitPlaylistId?: string;
  skipPlaylist?: boolean;
}): YoutubePlaylistTarget | undefined {
  if (input.skipPlaylist) {
    return undefined;
  }

  const series = input.publishPackage?.series;
  const publishPackagePlaylistId = input.publishPackage?.playlist?.id ?? input.publishPackage?.playlistId;

  if (input.explicitPlaylistId) {
    return {
      playlistId: input.explicitPlaylistId,
      source: "option",
      ...(series ? { series } : {})
    };
  }

  if (publishPackagePlaylistId) {
    return {
      playlistId: publishPackagePlaylistId,
      source: "publishPackage",
      ...(series ? { series } : {})
    };
  }

  if (series && input.targetChannel?.playlists[series]) {
    return {
      playlistId: input.targetChannel.playlists[series],
      source: "seriesProfile",
      series
    };
  }

  if (input.targetChannel?.defaultPlaylistId) {
    return {
      playlistId: input.targetChannel.defaultPlaylistId,
      source: "defaultProfile",
      ...(series ? { series } : {})
    };
  }

  return undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
