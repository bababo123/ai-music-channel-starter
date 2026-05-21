import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SqliteDatabase } from "../db/database";
import type { EpisodePlan } from "../domain/episode-plan";
import { slugify } from "../utils/slug";
import { dateId, nowIso } from "../utils/time";

export type CreateEpisodeInput = {
  seriesId: string;
  subtitle: string;
  publishAt?: string;
  outputRoot: string;
  plan: EpisodePlan;
};

export class EpisodeRepository {
  constructor(private readonly db: SqliteDatabase) {}

  createPlannedEpisode(input: CreateEpisodeInput) {
    const now = nowIso();
    const id = this.buildUniqueEpisodeId(input.seriesId, input.subtitle);
    const outputDir = join(input.outputRoot, id);
    mkdirSync(outputDir, { recursive: true });

    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `
INSERT INTO episodes (
  id,
  series_id,
  subtitle,
  title,
  thumbnail_text,
  status,
  publish_at,
  output_dir,
  plan_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`
        )
        .run(
          id,
          input.seriesId,
          input.subtitle,
          input.plan.title,
          input.plan.thumbnailText,
          "planned",
          input.publishAt ?? null,
          outputDir,
          JSON.stringify(input.plan, null, 2),
          now,
          now
        );

      const trackStatement = this.db.prepare(`
INSERT INTO tracks (
  id,
  episode_id,
  track_index,
  title,
  role,
  duration_target_seconds,
  prompt,
  status,
  metadata_json,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

      for (const track of input.plan.tracks) {
        trackStatement.run(
          `${id}-track-${track.index.toString().padStart(2, "0")}`,
          id,
          track.index,
          track.title,
          track.role,
          track.durationTargetSeconds,
          track.prompt,
          "planned",
          JSON.stringify({ provider: "minimax", model: "music-2.6" }),
          now,
          now
        );
      }

      const promptStatement = this.db.prepare(`
INSERT INTO prompts (
  id,
  episode_id,
  prompt_type,
  content,
  metadata_json,
  created_at
) VALUES (?, ?, ?, ?, ?, ?)
`);

      promptStatement.run(
        `${id}-visual-prompt`,
        id,
        "hero_image",
        input.plan.visualPrompt,
        JSON.stringify({ provider: "openai", model: "gpt-image-1.5" }),
        now
      );
      promptStatement.run(
        `${id}-thumbnail-prompt`,
        id,
        "thumbnail_base",
        input.plan.thumbnailPrompt,
        JSON.stringify({ provider: "openai", model: "gpt-image-1.5" }),
        now
      );
      promptStatement.run(
        `${id}-metadata-prompt`,
        id,
        "metadata",
        JSON.stringify(input.plan.metadata, null, 2),
        JSON.stringify({ generatedBy: "episode-plan" }),
        now
      );
    });

    create();

    return {
      id,
      outputDir,
      title: input.plan.title,
      trackCount: input.plan.trackCount,
      totalTargetSeconds: input.plan.totalTargetSeconds
    };
  }

  private buildUniqueEpisodeId(seriesId: string, subtitle: string) {
    const base = `${dateId()}-${seriesId}-${slugify(subtitle)}`;
    let candidate = base;
    let suffix = 2;

    const exists = this.db.prepare("SELECT 1 FROM episodes WHERE id = ?");

    while (exists.get(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
