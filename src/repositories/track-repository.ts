import type { SqliteDatabase } from "../db/database";
import type { MusicGenerationResult } from "../domain/music-provider";
import { nowIso } from "../utils/time";

export type EpisodeRow = {
  id: string;
  seriesId: string;
  subtitle: string;
  status: string;
  outputDir: string;
};

export type PlannedTrackRow = {
  id: string;
  episodeId: string;
  trackIndex: number;
  title: string;
  role: string;
  durationTargetSeconds: number;
  prompt: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type AudioTrackRow = PlannedTrackRow & {
  filePath: string;
  durationSeconds?: number;
};

type EpisodeDbRow = {
  id: string;
  series_id: string;
  subtitle: string;
  status: string;
  output_dir: string;
};

type TrackDbRow = {
  id: string;
  episode_id: string;
  track_index: number;
  title: string;
  role: string;
  duration_target_seconds: number;
  prompt: string;
  status: string;
  file_path: string | null;
  duration_seconds: number | null;
  metadata_json: string;
};

export class TrackRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getEpisode(episodeId: string): EpisodeRow | undefined {
    const row = this.db
      .prepare(
        "SELECT id, series_id, subtitle, status, output_dir FROM episodes WHERE id = ?"
      )
      .get(episodeId) as EpisodeDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      seriesId: row.series_id,
      subtitle: row.subtitle,
      status: row.status,
      outputDir: row.output_dir
    };
  }

  listPendingTracks(episodeId: string, trackIndex?: number) {
    const params: Array<string | number> = [episodeId];
    let where = "episode_id = ? AND status IN ('planned', 'music_failed')";

    if (trackIndex) {
      where += " AND track_index = ?";
      params.push(trackIndex);
    }

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
  prompt,
  status,
  metadata_json
FROM tracks
WHERE ${where}
ORDER BY track_index
`
      )
      .all(...params) as TrackDbRow[];

    return rows.map((row) => ({
      id: row.id,
      episodeId: row.episode_id,
      trackIndex: row.track_index,
      title: row.title,
      role: row.role,
      durationTargetSeconds: row.duration_target_seconds,
      prompt: row.prompt,
      status: row.status,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  listAudioTracksForQc(episodeId: string, trackIndex?: number) {
    const params: Array<string | number> = [episodeId];
    let where =
      "episode_id = ? AND status IN ('music_ready', 'audio_qc_failed', 'audio_qc_passed') AND file_path IS NOT NULL";

    if (trackIndex) {
      where += " AND track_index = ?";
      params.push(trackIndex);
    }

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
  prompt,
  status,
  file_path,
  duration_seconds,
  metadata_json
FROM tracks
WHERE ${where}
ORDER BY track_index
`
      )
      .all(...params) as TrackDbRow[];

    return rows.map((row) => ({
      id: row.id,
      episodeId: row.episode_id,
      trackIndex: row.track_index,
      title: row.title,
      role: row.role,
      durationTargetSeconds: row.duration_target_seconds,
      prompt: row.prompt,
      status: row.status,
      filePath: assertFilePath(row.file_path, row.id),
      ...(row.duration_seconds ? { durationSeconds: row.duration_seconds } : {}),
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  listAudioTracksForMix(episodeId: string) {
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
  prompt,
  status,
  file_path,
  duration_seconds,
  metadata_json
FROM tracks
WHERE episode_id = ?
  AND status = 'audio_qc_passed'
  AND file_path IS NOT NULL
ORDER BY track_index
`
      )
      .all(episodeId) as TrackDbRow[];

    return rows.map((row) => ({
      id: row.id,
      episodeId: row.episode_id,
      trackIndex: row.track_index,
      title: row.title,
      role: row.role,
      durationTargetSeconds: row.duration_target_seconds,
      prompt: row.prompt,
      status: row.status,
      filePath: assertFilePath(row.file_path, row.id),
      ...(row.duration_seconds ? { durationSeconds: row.duration_seconds } : {}),
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
    }));
  }

  markEpisodeStatus(episodeId: string, status: string) {
    this.db
      .prepare("UPDATE episodes SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), episodeId);
  }

  markTrackGenerating(trackId: string, metadata: Record<string, unknown>) {
    this.db
      .prepare(
        `
UPDATE tracks
SET status = 'music_generating',
    metadata_json = ?,
    updated_at = ?
WHERE id = ?
`
      )
      .run(JSON.stringify(metadata), nowIso(), trackId);
  }

  markTrackReady(trackId: string, result: MusicGenerationResult, metadata: Record<string, unknown>) {
    this.db
      .prepare(
        `
UPDATE tracks
SET status = 'music_ready',
    provider = ?,
    provider_job_id = ?,
    source_url = ?,
    file_path = ?,
    duration_seconds = ?,
    metadata_json = ?,
    updated_at = ?
WHERE id = ?
`
      )
      .run(
        result.provider,
        result.traceId ?? null,
        result.sourceUrl ?? null,
        result.filePath,
        result.durationSeconds ?? null,
        JSON.stringify(metadata),
        nowIso(),
        trackId
      );
  }

  markTrackFailed(trackId: string, metadata: Record<string, unknown>) {
    this.db
      .prepare(
        `
UPDATE tracks
SET status = 'music_failed',
    metadata_json = ?,
    updated_at = ?
WHERE id = ?
`
      )
      .run(JSON.stringify(metadata), nowIso(), trackId);
  }

  saveTrackQcResult(input: {
    episodeId: string;
    trackId: string;
    passed: boolean;
    checks: Record<string, unknown>;
    notes?: string;
  }) {
    const now = nowIso();
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `
INSERT INTO qc_results (
  id,
  episode_id,
  scope,
  scope_id,
  passed,
  checks_json,
  notes,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`
        )
        .run(
          `${input.trackId}-qc-${Date.now()}`,
          input.episodeId,
          "track",
          input.trackId,
          input.passed ? 1 : 0,
          JSON.stringify(input.checks, null, 2),
          input.notes ?? null,
          now
        );

      this.db
        .prepare("UPDATE tracks SET status = ?, updated_at = ? WHERE id = ?")
        .run(input.passed ? "audio_qc_passed" : "audio_qc_failed", now, input.trackId);
    });

    save();
  }

  resetTrackForRegeneration(input: {
    episodeId: string;
    trackIndex: number;
    title: string;
    role: string;
    durationTargetSeconds: number;
    prompt: string;
  }) {
    const current = this.db
      .prepare(
        "SELECT id, status, file_path, metadata_json FROM tracks WHERE episode_id = ? AND track_index = ?"
      )
      .get(input.episodeId, input.trackIndex) as
      | { id: string; status: string; file_path: string | null; metadata_json: string }
      | undefined;

    if (!current) {
      throw new Error(`Track not found: ${input.episodeId} #${input.trackIndex}`);
    }

    const metadata = {
      ...(JSON.parse(current.metadata_json) as Record<string, unknown>),
      promptVersion: "lofi-focus-v5",
      resetForRegenerationAt: nowIso(),
      previousStatus: current.status,
      previousFilePath: current.file_path
    };

    this.db
      .prepare(
        `
UPDATE tracks
SET title = ?,
    role = ?,
    duration_target_seconds = ?,
    prompt = ?,
    provider = NULL,
    provider_job_id = NULL,
    source_url = NULL,
    file_path = NULL,
    duration_seconds = NULL,
    status = 'planned',
    metadata_json = ?,
    updated_at = ?
WHERE id = ?
`
      )
      .run(
        input.title,
        input.role,
        input.durationTargetSeconds,
        input.prompt,
        JSON.stringify(metadata),
        nowIso(),
        current.id
      );

    this.markEpisodeStatus(input.episodeId, "planned");

    return {
      trackId: current.id,
      previousStatus: current.status,
      previousFilePath: current.file_path
    };
  }

  countTracksByStatus(episodeId: string) {
    const rows = this.db
      .prepare(
        "SELECT status, COUNT(*) as count FROM tracks WHERE episode_id = ? GROUP BY status"
      )
      .all(episodeId) as Array<{ status: string; count: number }>;

    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }

  countTracks(episodeId: string) {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM tracks WHERE episode_id = ?")
      .get(episodeId) as { count: number };

    return row.count;
  }
}

function assertFilePath(filePath: string | null, trackId: string) {
  if (!filePath) {
    throw new Error(`Track ${trackId} does not have a file path.`);
  }

  return filePath;
}
