export type Migration = {
  id: number;
  name: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  thumbnail_text TEXT NOT NULL,
  sound_brand_json TEXT NOT NULL,
  visual_template_json TEXT NOT NULL,
  metadata_tone_json TEXT NOT NULL,
  track_titles_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id),
  subtitle TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_text TEXT NOT NULL,
  status TEXT NOT NULL,
  publish_at TEXT,
  output_dir TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  track_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  duration_target_seconds INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  provider TEXT,
  provider_job_id TEXT,
  source_url TEXT,
  file_path TEXT,
  duration_seconds REAL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (episode_id, track_index)
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  prompt_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  provider TEXT,
  prompt TEXT,
  file_path TEXT,
  metadata_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qc_results (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  scope_id TEXT,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  checks_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  renderer TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  output_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_uploads (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  youtube_video_id TEXT,
  visibility TEXT NOT NULL,
  scheduled_publish_at TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  step TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_series_id ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
CREATE INDEX IF NOT EXISTS idx_tracks_episode_id ON tracks(episode_id);
CREATE INDEX IF NOT EXISTS idx_assets_episode_id ON assets(episode_id);
CREATE INDEX IF NOT EXISTS idx_qc_results_episode_id ON qc_results(episode_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_episode_id ON render_jobs(episode_id);
CREATE INDEX IF NOT EXISTS idx_youtube_uploads_episode_id ON youtube_uploads(episode_id);
`
  },
  {
    id: 2,
    name: "review_decisions",
    sql: `
CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  notes TEXT,
  package_asset_id TEXT,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_episode_id ON review_decisions(episode_id);
`
  },
  {
    id: 3,
    name: "youtube_upload_channel_key",
    sql: `
ALTER TABLE youtube_uploads ADD COLUMN channel_key TEXT;

CREATE INDEX IF NOT EXISTS idx_youtube_uploads_channel_key ON youtube_uploads(channel_key);
`
  },
  {
    id: 4,
    name: "youtube_performance_tracking",
    sql: `
CREATE TABLE IF NOT EXISTS youtube_performance_snapshots (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  channel_key TEXT,
  captured_at TEXT NOT NULL,
  privacy_status TEXT,
  upload_status TEXT,
  processing_status TEXT,
  duration TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_publish_experiments (
  id TEXT PRIMARY KEY,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  youtube_video_id TEXT,
  channel_key TEXT,
  series TEXT,
  title TEXT NOT NULL,
  thumbnail_path TEXT,
  thumbnail_concept TEXT,
  visual_style TEXT,
  music_style TEXT,
  duration_seconds REAL,
  track_count INTEGER,
  has_telemetry_overlay INTEGER NOT NULL CHECK (has_telemetry_overlay IN (0, 1)),
  has_per_track_scenes INTEGER NOT NULL CHECK (has_per_track_scenes IN (0, 1)),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (episode_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_youtube_performance_episode_id ON youtube_performance_snapshots(episode_id);
CREATE INDEX IF NOT EXISTS idx_youtube_performance_video_id ON youtube_performance_snapshots(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_youtube_performance_captured_at ON youtube_performance_snapshots(captured_at);
CREATE INDEX IF NOT EXISTS idx_youtube_publish_experiments_episode_id ON youtube_publish_experiments(episode_id);
CREATE INDEX IF NOT EXISTS idx_youtube_publish_experiments_video_id ON youtube_publish_experiments(youtube_video_id);
`
  }
];
