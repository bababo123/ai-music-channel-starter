import type { SqliteDatabase } from "../db/database";
import { nowIso } from "../utils/time";

export type ApprovalDecision = "approved" | "regenerate_requested";

export type SaveReviewDecisionInput = {
  episodeId: string;
  decision: ApprovalDecision;
  reviewer: string;
  notes?: string;
  packageAssetId?: string;
  metadata: Record<string, unknown>;
};

export type ApprovalEpisodeRow = {
  id: string;
  status: string;
  title: string;
};

export type ApprovalAssetRow = {
  id: string;
  assetType: string;
  status: string;
  filePath?: string;
  metadata: Record<string, unknown>;
};

type EpisodeDbRow = {
  id: string;
  status: string;
  title: string;
};

type AssetDbRow = {
  id: string;
  asset_type: string;
  status: string;
  file_path: string | null;
  metadata_json: string;
};

export class ApprovalRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getEpisode(episodeId: string): ApprovalEpisodeRow | undefined {
    const row = this.db
      .prepare("SELECT id, status, title FROM episodes WHERE id = ?")
      .get(episodeId) as EpisodeDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      status: row.status,
      title: row.title
    };
  }

  listAssets(episodeId: string) {
    const rows = this.db
      .prepare(
        `
SELECT id, asset_type, status, file_path, metadata_json
FROM assets
WHERE episode_id = ?
ORDER BY created_at
`
      )
      .all(episodeId) as AssetDbRow[];

    return rows.map((row): ApprovalAssetRow => ({
      id: row.id,
      assetType: row.asset_type,
      status: row.status,
      ...(row.file_path ? { filePath: row.file_path } : {}),
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  saveReviewDecision(input: SaveReviewDecisionInput) {
    const now = nowIso();
    const id = `${input.episodeId}-${input.decision}-${Date.now()}`;
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `
INSERT INTO review_decisions (
  id,
  episode_id,
  decision,
  reviewer,
  notes,
  package_asset_id,
  metadata_json,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`
        )
        .run(
          id,
          input.episodeId,
          input.decision,
          input.reviewer,
          input.notes ?? null,
          input.packageAssetId ?? null,
          JSON.stringify(input.metadata, null, 2),
          now
        );

      this.db
        .prepare("UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?")
        .run(input.decision, now, input.episodeId);

      if (input.packageAssetId) {
        this.db
          .prepare("UPDATE assets SET status = ?, updated_at = ? WHERE id = ?")
          .run(input.decision, now, input.packageAssetId);
      }
    });

    save();

    return {
      id,
      episodeId: input.episodeId,
      decision: input.decision,
      reviewer: input.reviewer,
      createdAt: now
    };
  }
}
