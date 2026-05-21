import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { migrate } from "../src/db/migrate";
import { createLogger } from "../src/config/logger";
import { YoutubePerformanceRepository } from "../src/repositories/youtube-performance-repository";

test("stores YouTube performance snapshots and experiment metadata", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db, createLogger("silent"));
  seedEpisode(db);

  const repository = new YoutubePerformanceRepository(db);
  repository.saveSnapshot({
    episodeId: "episode-1",
    youtubeVideoId: "video-1",
    channelKey: "orbital_focus",
    capturedAt: "2026-05-19T00:00:00.000Z",
    privacyStatus: "private",
    uploadStatus: "processed",
    processingStatus: "succeeded",
    duration: "PT1H3M57S",
    viewCount: 10,
    likeCount: 1,
    commentCount: 0,
    favoriteCount: 0,
    raw: { source: "test" }
  });
  repository.saveSnapshot({
    episodeId: "episode-1",
    youtubeVideoId: "video-1",
    channelKey: "orbital_focus",
    capturedAt: "2026-05-20T00:00:00.000Z",
    viewCount: 42,
    likeCount: 3,
    commentCount: 1,
    favoriteCount: 0,
    raw: { source: "test" }
  });

  repository.upsertExperiment({
    episodeId: "episode-1",
    youtubeVideoId: "video-1",
    channelKey: "orbital_focus",
    series: "Orbital Systems",
    title: "Orbital Systems | 1 Hour Space Lofi for Coding & Deep Focus",
    thumbnailPath: "D:/thumbnail.png",
    thumbnailConcept: "orbital megastructure with clean typography",
    visualStyle: "space station megastructure",
    musicStyle: "space lofi coding ambient",
    durationSeconds: 3836.437,
    trackCount: 18,
    hasTelemetryOverlay: true,
    hasPerTrackScenes: true,
    metadata: { test: true }
  });

  const snapshots = repository.listSnapshots({
    episodeId: "episode-1",
    channelKey: "orbital_focus"
  });
  const report = repository.getPerformanceReport({
    episodeId: "episode-1",
    channelKey: "orbital_focus"
  });

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.viewCount, 10);
  assert.equal(snapshots[1]?.viewCount, 42);
  assert.equal(report.snapshotCount, 2);
  assert.equal(report.firstSnapshot?.viewCount, 10);
  assert.equal(report.latestSnapshot?.viewCount, 42);
  assert.equal(report.delta?.viewCount, 32);
  assert.equal(report.experiment?.hasTelemetryOverlay, true);
  assert.equal(report.experiment?.trackCount, 18);

  db.close();
});

function seedEpisode(db: Database.Database) {
  const now = "2026-05-19T00:00:00.000Z";

  db.prepare(
    `
INSERT INTO series (
  id,
  name,
  thumbnail_text,
  sound_brand_json,
  visual_template_json,
  metadata_tone_json,
  track_titles_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`
  ).run("orbital-systems", "Orbital Systems", "ORBITAL FOCUS", "{}", "{}", "{}", "[]", now, now);

  db.prepare(
    `
INSERT INTO episodes (
  id,
  series_id,
  subtitle,
  title,
  thumbnail_text,
  status,
  output_dir,
  plan_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
  ).run(
    "episode-1",
    "orbital-systems",
    "Orbital Systems",
    "Orbital Systems | 1 Hour Space Lofi for Coding & Deep Focus",
    "ORBITAL FOCUS",
    "uploaded",
    "outputs/episode-1",
    JSON.stringify({ seriesName: "Orbital Systems", metadata: { tags: [] } }),
    now,
    now
  );
}
