import type { SqliteDatabase } from "../db/database";
import type { EpisodePlan } from "../domain/episode-plan";

export type PublishEpisodeRow = {
  id: string;
  seriesId: string;
  subtitle: string;
  title: string;
  thumbnailText: string;
  status: string;
  outputDir: string;
  plan: EpisodePlan;
  publishAt?: string;
};

export type PublishTrackRow = {
  id: string;
  episodeId: string;
  trackIndex: number;
  title: string;
  role: string;
  durationTargetSeconds: number;
  status: string;
  filePath?: string;
  durationSeconds?: number;
  metadata: Record<string, unknown>;
};

export type PublishAssetRow = {
  id: string;
  episodeId: string;
  assetType: string;
  provider?: string;
  prompt?: string;
  filePath?: string;
  status: string;
  metadata: Record<string, unknown>;
};

type EpisodeDbRow = {
  id: string;
  series_id: string;
  subtitle: string;
  title: string;
  thumbnail_text: string;
  status: string;
  publish_at: string | null;
  output_dir: string;
  plan_json: string;
};

type TrackDbRow = {
  id: string;
  episode_id: string;
  track_index: number;
  title: string;
  role: string;
  duration_target_seconds: number;
  status: string;
  file_path: string | null;
  duration_seconds: number | null;
  metadata_json: string;
};

type AssetDbRow = {
  id: string;
  episode_id: string;
  asset_type: string;
  provider: string | null;
  prompt: string | null;
  file_path: string | null;
  status: string;
  metadata_json: string;
};

export class PublishPackageRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getEpisode(episodeId: string): PublishEpisodeRow | undefined {
    const row = this.db
      .prepare(
        `
SELECT
  id,
  series_id,
  subtitle,
  title,
  thumbnail_text,
  status,
  publish_at,
  output_dir,
  plan_json
FROM episodes
WHERE id = ?
`
      )
      .get(episodeId) as EpisodeDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      seriesId: row.series_id,
      subtitle: row.subtitle,
      title: row.title,
      thumbnailText: row.thumbnail_text,
      status: row.status,
      outputDir: row.output_dir,
      plan: JSON.parse(row.plan_json) as EpisodePlan,
      ...(row.publish_at ? { publishAt: row.publish_at } : {})
    };
  }

  listTracks(episodeId: string) {
    const rows = this.db
      .prepare(
        `
SELECT
  id,
  episode_id,
  track_index,
  title,
  role,
  duration_target_seconds,
  status,
  file_path,
  duration_seconds,
  metadata_json
FROM tracks
WHERE episode_id = ?
ORDER BY track_index
`
      )
      .all(episodeId) as TrackDbRow[];

    return rows.map((row): PublishTrackRow => ({
      id: row.id,
      episodeId: row.episode_id,
      trackIndex: row.track_index,
      title: row.title,
      role: row.role,
      durationTargetSeconds: row.duration_target_seconds,
      status: row.status,
      ...(row.file_path ? { filePath: row.file_path } : {}),
      ...(row.duration_seconds ? { durationSeconds: row.duration_seconds } : {}),
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  listAssets(episodeId: string) {
    const rows = this.db
      .prepare(
        `
SELECT
  id,
  episode_id,
  asset_type,
  provider,
  prompt,
  file_path,
  status,
  metadata_json
FROM assets
WHERE episode_id = ?
ORDER BY created_at
`
      )
      .all(episodeId) as AssetDbRow[];

    return rows.map((row): PublishAssetRow => ({
      id: row.id,
      episodeId: row.episode_id,
      assetType: row.asset_type,
      ...(row.provider ? { provider: row.provider } : {}),
      ...(row.prompt ? { prompt: row.prompt } : {}),
      ...(row.file_path ? { filePath: row.file_path } : {}),
      status: row.status,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }
}
