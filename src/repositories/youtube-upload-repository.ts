import type { SqliteDatabase } from "../db/database";
import { nowIso } from "../utils/time";

export type SaveYoutubeUploadInput = {
  episodeId: string;
  youtubeVideoId?: string;
  channelKey?: string;
  visibility: string;
  scheduledPublishAt?: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type YoutubeUploadRow = {
  id: string;
  episodeId: string;
  youtubeVideoId?: string;
  channelKey?: string;
  visibility: string;
  scheduledPublishAt?: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type LatestYoutubeVideoRow = {
  episodeId: string;
  youtubeVideoId: string;
  channelKey?: string;
  status: string;
  createdAt: string;
};

export class YoutubeUploadRepository {
  constructor(private readonly db: SqliteDatabase) {}

  saveUpload(input: SaveYoutubeUploadInput) {
    const now = nowIso();
    const id = `${input.episodeId}-youtube-upload-${Date.now()}`;

    this.db
      .prepare(
        `
INSERT INTO youtube_uploads (
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  visibility,
  scheduled_publish_at,
  status,
  metadata_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        id,
        input.episodeId,
        input.youtubeVideoId ?? null,
        input.channelKey ?? null,
        input.visibility,
        input.scheduledPublishAt ?? null,
        input.status,
        JSON.stringify(input.metadata, null, 2),
        now,
        now
      );

    return {
      id,
      createdAt: now
    };
  }

  findLatestWithVideoId(episodeId: string, channelKey?: string) {
    const params: unknown[] = [episodeId];
    const channelFilter = channelKey ? "AND (channel_key = ? OR channel_key IS NULL)" : "";

    if (channelKey) {
      params.push(channelKey);
    }

    const row = this.db
      .prepare(
        `
SELECT
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  visibility,
  scheduled_publish_at,
  status,
  metadata_json,
  created_at,
  updated_at
FROM youtube_uploads
WHERE episode_id = ?
  AND youtube_video_id IS NOT NULL
  ${channelFilter}
ORDER BY created_at DESC
LIMIT 1
`
      )
      .get(...params);

    return row ? mapUploadRow(row) : undefined;
  }

  listLatestUploadedVideos(input: { channelKey?: string; limit?: number } = {}) {
    const params: unknown[] = [];
    const channelFilter = input.channelKey ? "AND channel_key = ?" : "";

    if (input.channelKey) {
      params.push(input.channelKey);
    }

    const rows = this.db
      .prepare(
        `
SELECT
  episode_id,
  youtube_video_id,
  channel_key,
  status,
  created_at
FROM youtube_uploads
WHERE youtube_video_id IS NOT NULL
  ${channelFilter}
ORDER BY created_at DESC
`
      )
      .all(...params) as Array<{
      episode_id: string;
      youtube_video_id: string | null;
      channel_key: string | null;
      status: string;
      created_at: string;
    }>;

    const byEpisode = new Map<string, LatestYoutubeVideoRow>();

    for (const row of rows) {
      if (!row.youtube_video_id || byEpisode.has(row.episode_id)) {
        continue;
      }

      byEpisode.set(row.episode_id, {
        episodeId: row.episode_id,
        youtubeVideoId: row.youtube_video_id,
        ...(row.channel_key ? { channelKey: row.channel_key } : {}),
        status: row.status,
        createdAt: row.created_at
      });

      if (input.limit && byEpisode.size >= input.limit) {
        break;
      }
    }

    return [...byEpisode.values()];
  }
}

function mapUploadRow(row: unknown): YoutubeUploadRow {
  const record = row as {
    id: string;
    episode_id: string;
    youtube_video_id: string | null;
    channel_key: string | null;
    visibility: string;
    scheduled_publish_at: string | null;
    status: string;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  };

  return {
    id: record.id,
    episodeId: record.episode_id,
    ...(record.youtube_video_id ? { youtubeVideoId: record.youtube_video_id } : {}),
    ...(record.channel_key ? { channelKey: record.channel_key } : {}),
    visibility: record.visibility,
    ...(record.scheduled_publish_at ? { scheduledPublishAt: record.scheduled_publish_at } : {}),
    status: record.status,
    metadata: JSON.parse(record.metadata_json) as Record<string, unknown>,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}
