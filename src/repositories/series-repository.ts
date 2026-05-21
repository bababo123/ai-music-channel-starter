import type { SqliteDatabase } from "../db/database";
import type { SeriesConfig } from "../domain/series";
import { seriesConfigs } from "../domain/series";
import { nowIso } from "../utils/time";

export class SeriesRepository {
  constructor(private readonly db: SqliteDatabase) {}

  seedDefaults() {
    const now = nowIso();
    const statement = this.db.prepare(`
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
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  thumbnail_text = excluded.thumbnail_text,
  sound_brand_json = excluded.sound_brand_json,
  visual_template_json = excluded.visual_template_json,
  metadata_tone_json = excluded.metadata_tone_json,
  track_titles_json = excluded.track_titles_json,
  updated_at = excluded.updated_at
`);

    const seed = this.db.transaction((configs: SeriesConfig[]) => {
      for (const config of configs) {
        statement.run(
          config.id,
          config.name,
          config.thumbnailText,
          JSON.stringify(config.soundBrand),
          JSON.stringify(config.visualTemplate),
          JSON.stringify(config.metadataTone),
          JSON.stringify(config.trackTitles),
          now,
          now
        );
      }
    });

    seed(seriesConfigs);
  }

  listIds() {
    return this.db
      .prepare("SELECT id FROM series ORDER BY id")
      .all()
      .map((row) => (row as { id: string }).id);
  }
}
