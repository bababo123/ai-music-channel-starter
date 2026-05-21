import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { google, type youtube_v3 } from "googleapis";

export const youtubeAuthScopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube"
] as const;

export type YouTubeTargetChannel = {
  key: string;
  name?: string;
  channelId?: string;
  redirectUri: string;
  defaultPlaylistId?: string;
  playlists: Record<string, string>;
};

export type YouTubeUploadProviderOptions = {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  redirectUri: string;
  channelKey?: string;
  channelName?: string;
  channelId?: string;
  defaultPlaylistId?: string;
  playlists?: Record<string, string>;
};

export type YouTubeUploadVideoInput = {
  videoPath: string;
  thumbnailPath?: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "private" | "unlisted" | "public";
  categoryId: string;
  publishAt?: string;
  notifySubscribers: boolean;
  containsSyntheticMedia: boolean;
  selfDeclaredMadeForKids: boolean;
};

export type YouTubePlaylistInsertInput = {
  videoId: string;
  playlistId: string;
  position?: number;
};

export type YouTubeThumbnailSetInput = {
  videoId: string;
  thumbnailPath: string;
  mimeType?: string;
};

export class YouTubeUploadProvider {
  constructor(private readonly options: YouTubeUploadProviderOptions) {}

  get targetChannel(): YouTubeTargetChannel {
    return {
      key: this.options.channelKey ?? "default",
      ...(this.options.channelName ? { name: this.options.channelName } : {}),
      ...(this.options.channelId ? { channelId: this.options.channelId } : {}),
      redirectUri: this.options.redirectUri,
      ...(this.options.defaultPlaylistId ? { defaultPlaylistId: this.options.defaultPlaylistId } : {}),
      playlists: this.options.playlists ?? {}
    };
  }

  createAuthUrl() {
    return this.createOAuthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [...youtubeAuthScopes]
    });
  }

  async exchangeCode(code: string) {
    const { tokens } = await this.createOAuthClient().getToken(code);

    return {
      hasRefreshToken: Boolean(tokens.refresh_token),
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date
    };
  }

  async uploadVideo(input: YouTubeUploadVideoInput) {
    const youtube = this.createAuthorizedYouTube();
    const video = await youtube.videos.insert({
      part: ["snippet", "status"],
      notifySubscribers: input.notifySubscribers,
      requestBody: {
        snippet: {
          title: input.title,
          description: input.description,
          tags: input.tags,
          categoryId: input.categoryId,
          defaultLanguage: "en",
          defaultAudioLanguage: "en"
        },
        status: {
          privacyStatus: input.privacyStatus,
          selfDeclaredMadeForKids: input.selfDeclaredMadeForKids,
          containsSyntheticMedia: input.containsSyntheticMedia,
          ...(input.publishAt ? { publishAt: input.publishAt } : {})
        }
      } satisfies youtube_v3.Schema$Video,
      media: {
        mimeType: "video/mp4",
        body: createReadStream(input.videoPath)
      }
    });
    const videoId = video.data.id;

    if (!videoId) {
      throw new Error("YouTube upload completed without returning a video ID.");
    }

    let thumbnailSet = false;
    let thumbnailError: string | undefined;

    if (input.thumbnailPath) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: {
            mimeType: "image/png",
            body: createReadStream(input.thumbnailPath)
          }
        });
        thumbnailSet = true;
      } catch (error) {
        thumbnailError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      privacyStatus: input.privacyStatus,
      thumbnailSet,
      channel: this.targetChannel,
      ...(thumbnailError ? { thumbnailError } : {})
    };
  }

  async getVideoStatus(videoId: string) {
    const youtube = this.createAuthorizedYouTube();
    const response = await youtube.videos.list({
      part: ["snippet", "status", "processingDetails", "statistics", "contentDetails"],
      id: [videoId]
    });
    const video = response.data.items?.[0];

    if (!video) {
      throw new Error(`YouTube video not found or not visible to this channel: ${videoId}`);
    }

    return normalizeVideoStatus(video, videoId);
  }

  async addVideoToPlaylist(input: YouTubePlaylistInsertInput) {
    const youtube = this.createAuthorizedYouTube();
    const response = await youtube.playlistItems.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          playlistId: input.playlistId,
          ...(input.position !== undefined ? { position: input.position } : {}),
          resourceId: {
            kind: "youtube#video",
            videoId: input.videoId
          }
        }
      }
    });
    const playlistItemId = response.data.id;

    if (!playlistItemId) {
      throw new Error("YouTube playlist insertion completed without returning a playlist item ID.");
    }

    return {
      playlistItemId,
      playlistId: input.playlistId,
      videoId: input.videoId,
      channel: this.targetChannel
    };
  }

  async setThumbnail(input: YouTubeThumbnailSetInput) {
    const youtube = this.createAuthorizedYouTube();
    const response = await youtube.thumbnails.set({
      videoId: input.videoId,
      media: {
        mimeType: input.mimeType ?? inferThumbnailMimeType(input.thumbnailPath),
        body: createReadStream(input.thumbnailPath)
      }
    });

    return {
      videoId: input.videoId,
      thumbnailSet: true,
      thumbnailCount: response.data.items?.length ?? 0,
      channel: this.targetChannel
    };
  }

  private createOAuthClient() {
    return new google.auth.OAuth2(
      this.options.clientId,
      this.options.clientSecret,
      this.options.redirectUri
    );
  }

  private createAuthorizedYouTube() {
    const client = this.createOAuthClient();

    if (!this.options.refreshToken) {
      throw new Error("YOUTUBE_REFRESH_TOKEN is required to call YouTube Data API.");
    }

    client.setCredentials({ refresh_token: this.options.refreshToken });

    return google.youtube({ version: "v3", auth: client });
  }
}

function inferThumbnailMimeType(filePath: string) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  return "image/png";
}

function normalizeVideoStatus(video: youtube_v3.Schema$Video, fallbackVideoId: string) {
  const snippet = video.snippet;
  const status = video.status;
  const processingDetails = video.processingDetails;
  const statistics = video.statistics;
  const contentDetails = video.contentDetails;

  return {
    videoId: video.id ?? fallbackVideoId,
    ...(snippet?.title ? { title: snippet.title } : {}),
    ...(snippet?.publishedAt ? { publishedAt: snippet.publishedAt } : {}),
    ...(status?.privacyStatus ? { privacyStatus: status.privacyStatus } : {}),
    ...(status?.uploadStatus ? { uploadStatus: status.uploadStatus } : {}),
    ...(status?.publishAt ? { scheduledPublishAt: status.publishAt } : {}),
    ...(status?.madeForKids !== undefined ? { madeForKids: status.madeForKids } : {}),
    ...(status?.selfDeclaredMadeForKids !== undefined
      ? { selfDeclaredMadeForKids: status.selfDeclaredMadeForKids }
      : {}),
    ...(processingDetails?.processingStatus
      ? { processingStatus: processingDetails.processingStatus }
      : {}),
    ...(processingDetails?.processingFailureReason
      ? { processingFailureReason: processingDetails.processingFailureReason }
      : {}),
    ...(contentDetails?.duration ? { duration: contentDetails.duration } : {}),
    ...(statistics?.viewCount ? { viewCount: statistics.viewCount } : {}),
    ...(statistics?.likeCount ? { likeCount: statistics.likeCount } : {}),
    ...(statistics?.commentCount ? { commentCount: statistics.commentCount } : {}),
    ...(statistics?.favoriteCount ? { favoriteCount: statistics.favoriteCount } : {})
  };
}
