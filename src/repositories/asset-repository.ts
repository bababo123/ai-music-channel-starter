import type { SqliteDatabase } from "../db/database";
import { nowIso } from "../utils/time";

export type SaveAssetInput = {
  id: string;
  episodeId: string;
  assetType: string;
  provider?: string;
  prompt?: string;
  filePath: string;
  status: string;
  metadata: Record<string, unknown>;
};

export class AssetRepository {
  constructor(private readonly db: SqliteDatabase) {}

  saveAsset(input: SaveAssetInput) {
    const now = nowIso();

    this.db
      .prepare(
        `
INSERT INTO assets (
  id,
  episode_id,
  asset_type,
  provider,
  prompt,
  file_path,
  metadata_json,
  status,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  provider = excluded.provider,
  prompt = excluded.prompt,
  file_path = excluded.file_path,
  metadata_json = excluded.metadata_json,
  status = excluded.status,
  updated_at = excluded.updated_at
`
      )
      .run(
        input.id,
        input.episodeId,
        input.assetType,
        input.provider ?? null,
        input.prompt ?? null,
        input.filePath,
        JSON.stringify(input.metadata, null, 2),
        input.status,
        now,
        now
      );
  }
}
