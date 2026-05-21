import type pino from "pino";
import type { SqliteDatabase } from "./database";
import { migrations } from "./migrations";
import { nowIso } from "../utils/time";

export function migrate(db: SqliteDatabase, logger: pino.Logger) {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: number }).id)
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
      ).run(migration.id, migration.name, nowIso());
    });

    applyMigration();
    logger.info({ migration: migration.name }, "Applied database migration");
  }
}
