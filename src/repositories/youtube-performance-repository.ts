import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../db/database";
import { nowIso } from "../utils/time";

export type SaveYoutubePerformanceSnapshotInput = {
  episodeId: string;
  youtubeVideoId: string;
  channelKey?: string;
  capturedAt?: string;
  privacyStatus?: string;
  uploadStatus?: string;
  processingStatus?: string;
  duration?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  favoriteCount?: number;
  raw: Record<string, unknown>;
};

export type YoutubePerformanceSnapshotRow = {
  id: string;
  episodeId: string;
  youtubeVideoId: string;
  channelKey?: string;
  capturedAt: string;
  privacyStatus?: string;
  uploadStatus?: string;
  processingStatus?: string;
  duration?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  raw: Record<string, unknown>;
  createdAt: string;
};

export type UpsertYoutubePublishExperimentInput = {
  episodeId: string;
  youtubeVideoId?: string;
  channelKey?: string;
  series?: string;
  title: string;
  thumbnailPath?: string;
  thumbnailConcept?: string;
  visualStyle?: string;
  musicStyle?: string;
  durationSeconds?: number;
  trackCount?: number;
  hasTelemetryOverlay: boolean;
  hasPerTrackScenes: boolean;
  metadata: Record<string, unknown>;
};

export type YoutubePublishExperimentRow = {
  id: string;
  episodeId: string;
  youtubeVideoId?: string;
  channelKey?: string;
  series?: string;
  title: string;
  thumbnailPath?: string;
  thumbnailConcept?: string;
  visualStyle?: string;
  musicStyle?: string;
  durationSeconds?: number;
  trackCount?: number;
  hasTelemetryOverlay: boolean;
  hasPerTrackScenes: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type YoutubePerformanceQuery = {
  episodeId: string;
  channelKey?: string;
};

export class YoutubePerformanceRepository {
  constructor(private readonly db: SqliteDatabase) {}

  saveSnapshot(input: SaveYoutubePerformanceSnapshotInput) {
    const now = nowIso();
    const capturedAt = input.capturedAt ?? now;
    const id = `${input.episodeId}-youtube-performance-${randomUUID()}`;

    this.db
      .prepare(
        `
INSERT INTO youtube_performance_snapshots (
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  captured_at,
  privacy_status,
  upload_status,
  processing_status,
  duration,
  view_count,
  like_count,
  comment_count,
  favorite_count,
  raw_json,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
      )
      .run(
        id,
        input.episodeId,
        input.youtubeVideoId,
        input.channelKey ?? null,
        capturedAt,
        input.privacyStatus ?? null,
        input.uploadStatus ?? null,
        input.processingStatus ?? null,
        input.duration ?? null,
        input.viewCount ?? 0,
        input.likeCount ?? 0,
        input.commentCount ?? 0,
        input.favoriteCount ?? 0,
        JSON.stringify(input.raw, null, 2),
        now
      );

    return {
      id,
      capturedAt,
      createdAt: now
    };
  }

  listSnapshots(query: YoutubePerformanceQuery) {
    const params: unknown[] = [query.episodeId];
    const channelFilter = query.channelKey ? "AND (channel_key = ? OR channel_key IS NULL)" : "";

    if (query.channelKey) {
      params.push(query.channelKey);
    }

    const rows = this.db
      .prepare(
        `
SELECT
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  captured_at,
  privacy_status,
  upload_status,
  processing_status,
  duration,
  view_count,
  like_count,
  comment_count,
  favorite_count,
  raw_json,
  created_at
FROM youtube_performance_snapshots
WHERE episode_id = ?
  ${channelFilter}
ORDER BY captured_at ASC, created_at ASC
`
      )
      .all(...params);

    return rows.map(mapSnapshotRow);
  }

  upsertExperiment(input: UpsertYoutubePublishExperimentInput) {
    const now = nowIso();
    const id = `${input.episodeId}-youtube-publish-experiment-${input.channelKey ?? "default"}`;

    this.db
      .prepare(
        `
INSERT INTO youtube_publish_experiments (
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  series,
  title,
  thumbnail_path,
  thumbnail_concept,
  visual_style,
  music_style,
  duration_seconds,
  track_count,
  has_telemetry_overlay,
  has_per_track_scenes,
  metadata_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(episode_id, channel_key) DO UPDATE SET
  youtube_video_id = excluded.youtube_video_id,
  series = excluded.series,
  title = excluded.title,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_concept = excluded.thumbnail_concept,
  visual_style = excluded.visual_style,
  music_style = excluded.music_style,
  duration_seconds = excluded.duration_seconds,
  track_count = excluded.track_count,
  has_telemetry_overlay = excluded.has_telemetry_overlay,
  has_per_track_scenes = excluded.has_per_track_scenes,
  metadata_json = excluded.metadata_json,
  updated_at = excluded.updated_at
`
      )
      .run(
        id,
        input.episodeId,
        input.youtubeVideoId ?? null,
        input.channelKey ?? null,
        input.series ?? null,
        input.title,
        input.thumbnailPath ?? null,
        input.thumbnailConcept ?? null,
        input.visualStyle ?? null,
        input.musicStyle ?? null,
        input.durationSeconds ?? null,
        input.trackCount ?? null,
        input.hasTelemetryOverlay ? 1 : 0,
        input.hasPerTrackScenes ? 1 : 0,
        JSON.stringify(input.metadata, null, 2),
        now,
        now
      );

    return {
      id,
      updatedAt: now
    };
  }

  getExperiment(query: YoutubePerformanceQuery) {
    const params: unknown[] = [query.episodeId];
    const channelFilter = query.channelKey ? "AND (channel_key = ? OR channel_key IS NULL)" : "";

    if (query.channelKey) {
      params.push(query.channelKey);
    }

    const row = this.db
      .prepare(
        `
SELECT
  id,
  episode_id,
  youtube_video_id,
  channel_key,
  series,
  title,
  thumbnail_path,
  thumbnail_concept,
  visual_style,
  music_style,
  duration_seconds,
  track_count,
  has_telemetry_overlay,
  has_per_track_scenes,
  metadata_json,
  created_at,
  updated_at
FROM youtube_publish_experiments
WHERE episode_id = ?
  ${channelFilter}
ORDER BY updated_at DESC
LIMIT 1
`
      )
      .get(...params);

    return row ? mapExperimentRow(row) : undefined;
  }

  getPerformanceReport(query: YoutubePerformanceQuery) {
    const snapshots = this.listSnapshots(query);
    const firstSnapshot = snapshots[0];
    const latestSnapshot = snapshots.at(-1);

    return {
      episodeId: query.episodeId,
      ...(query.channelKey ? { channelKey: query.channelKey } : {}),
      snapshotCount: snapshots.length,
      ...(firstSnapshot ? { firstSnapshot } : {}),
      ...(latestSnapshot ? { latestSnapshot } : {}),
      ...(firstSnapshot && latestSnapshot
        ? {
            delta: {
              viewCount: latestSnapshot.viewCount - firstSnapshot.viewCount,
              likeCount: latestSnapshot.likeCount - firstSnapshot.likeCount,
              commentCount: latestSnapshot.commentCount - firstSnapshot.commentCount,
              favoriteCount: latestSnapshot.favoriteCount - firstSnapshot.favoriteCount
            }
          }
        : {}),
      experiment: this.getExperiment(query)
    };
  }
}

function mapSnapshotRow(row: unknown): YoutubePerformanceSnapshotRow {
  const record = row as {
    id: string;
    episode_id: string;
    youtube_video_id: string;
    channel_key: string | null;
    captured_at: string;
    privacy_status: string | null;
    upload_status: string | null;
    processing_status: string | null;
    duration: string | null;
    view_count: number;
    like_count: number;
    comment_count: number;
    favorite_count: number;
    raw_json: string;
    created_at: string;
  };

  return {
    id: record.id,
    episodeId: record.episode_id,
    youtubeVideoId: record.youtube_video_id,
    ...(record.channel_key ? { channelKey: record.channel_key } : {}),
    capturedAt: record.captured_at,
    ...(record.privacy_status ? { privacyStatus: record.privacy_status } : {}),
    ...(record.upload_status ? { uploadStatus: record.upload_status } : {}),
    ...(record.processing_status ? { processingStatus: record.processing_status } : {}),
    ...(record.duration ? { duration: record.duration } : {}),
    viewCount: record.view_count,
    likeCount: record.like_count,
    commentCount: record.comment_count,
    favoriteCount: record.favorite_count,
    raw: JSON.parse(record.raw_json) as Record<string, unknown>,
    createdAt: record.created_at
  };
}

function mapExperimentRow(row: unknown): YoutubePublishExperimentRow {
  const record = row as {
    id: string;
    episode_id: string;
    youtube_video_id: string | null;
    channel_key: string | null;
    series: string | null;
    title: string;
    thumbnail_path: string | null;
    thumbnail_concept: string | null;
    visual_style: string | null;
    music_style: string | null;
    duration_seconds: number | null;
    track_count: number | null;
    has_telemetry_overlay: number;
    has_per_track_scenes: number;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  };

  return {
    id: record.id,
    episodeId: record.episode_id,
    ...(record.youtube_video_id ? { youtubeVideoId: record.youtube_video_id } : {}),
    ...(record.channel_key ? { channelKey: record.channel_key } : {}),
    ...(record.series ? { series: record.series } : {}),
    title: record.title,
    ...(record.thumbnail_path ? { thumbnailPath: record.thumbnail_path } : {}),
    ...(record.thumbnail_concept ? { thumbnailConcept: record.thumbnail_concept } : {}),
    ...(record.visual_style ? { visualStyle: record.visual_style } : {}),
    ...(record.music_style ? { musicStyle: record.music_style } : {}),
    ...(record.duration_seconds !== null ? { durationSeconds: record.duration_seconds } : {}),
    ...(record.track_count !== null ? { trackCount: record.track_count } : {}),
    hasTelemetryOverlay: record.has_telemetry_overlay === 1,
    hasPerTrackScenes: record.has_per_track_scenes === 1,
    metadata: JSON.parse(record.metadata_json) as Record<string, unknown>,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}
