import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "../config/env";

export type SqliteDatabase = Database.Database;

export function openDatabase(config: AppConfig) {
  mkdirSync(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  return db;
}
