import type { SqliteDatabase } from "../db/database";
import type { EpisodePlan } from "../domain/episode-plan";
import { nowIso } from "../utils/time";

export type RefreshEpisodePlanResult = {
  episodeId: string;
  updatedTracks: number;
  skippedTracks: number;
  skippedTrackStatuses: Record<string, number>;
};

export class EpisodePlanRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getEpisodePlan(episodeId: string) {
    const row = this.db
      .prepare("SELECT plan_json FROM episodes WHERE id = ?")
      .get(episodeId) as { plan_json: string } | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.plan_json) as EpisodePlan;
  }

  refreshEpisodePlan(input: {
    episodeId: string;
    plan: EpisodePlan;
    includeGenerated?: boolean;
  }): RefreshEpisodePlanResult {
    const now = nowIso();
    const refresh = this.db.transaction(() => {
      this.db
        .prepare(
          `
UPDATE episodes
SET title = ?,
    thumbnail_text = ?,
    plan_json = ?,
    updated_at = ?
WHERE id = ?
`
        )
        .run(
          input.plan.title,
          input.plan.thumbnailText,
          JSON.stringify(input.plan, null, 2),
          now,
          input.episodeId
        );

      let updatedTracks = 0;
      const skippedTrackStatuses: Record<string, number> = {};
      const updateTrack = this.db.prepare(
        `
UPDATE tracks
SET title = ?,
    role = ?,
    duration_target_seconds = ?,
    prompt = ?,
    metadata_json = ?,
    updated_at = ?
WHERE episode_id = ?
  AND track_index = ?
  AND status IN (${input.includeGenerated ? allTrackStatusesSql : refreshableTrackStatusesSql})
`
      );

      const getTrack = this.db.prepare(
        "SELECT status, metadata_json FROM tracks WHERE episode_id = ? AND track_index = ?"
      );

      for (const track of input.plan.tracks) {
        const current = getTrack.get(input.episodeId, track.index) as
          | { status: string; metadata_json: string }
          | undefined;

        if (!current) {
          continue;
        }

        const metadata = {
          ...(JSON.parse(current.metadata_json) as Record<string, unknown>),
          promptVersion: "lofi-focus-v5",
          promptRefreshedAt: now
        };
        const result = updateTrack.run(
          track.title,
          track.role,
          track.durationTargetSeconds,
          track.prompt,
          JSON.stringify(metadata),
          now,
          input.episodeId,
          track.index
        );

        if (result.changes > 0) {
          updatedTracks += 1;
        } else {
          skippedTrackStatuses[current.status] = (skippedTrackStatuses[current.status] ?? 0) + 1;
        }
      }

      return {
        episodeId: input.episodeId,
        updatedTracks,
        skippedTracks: Object.values(skippedTrackStatuses).reduce((total, count) => total + count, 0),
        skippedTrackStatuses
      };
    });

    return refresh();
  }
}

const refreshableTrackStatusesSql = "'planned', 'music_failed'";
const allTrackStatusesSql =
  "'planned', 'music_failed', 'music_ready', 'audio_qc_failed', 'audio_qc_passed'";
