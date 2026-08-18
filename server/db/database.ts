import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { schema } from "./schema.js";

const migrateReviewState = (db: Database.Database) => {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(review_state)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const additions = [
    ["state", "INTEGER NOT NULL DEFAULT 0"],
    ["stability", "REAL NOT NULL DEFAULT 0"],
    ["difficulty", "REAL NOT NULL DEFAULT 0"],
    ["elapsed_days", "INTEGER NOT NULL DEFAULT 0"],
    ["scheduled_days", "INTEGER NOT NULL DEFAULT 0"],
    ["learning_steps", "INTEGER NOT NULL DEFAULT 0"],
    ["last_review", "TEXT"],
  ] as const;
  const added = new Set<string>();

  for (const [name, definition] of additions) {
    if (columns.has(name)) continue;
    db.exec(`ALTER TABLE review_state ADD COLUMN ${name} ${definition}`);
    added.add(name);
  }

  if (added.has("state")) {
    db.exec(`
      UPDATE review_state
      SET state = 2,
          stability = MAX(1, ROUND(julianday(due_at) - julianday(updated_at))),
          difficulty = 5,
          scheduled_days = MAX(1, ROUND(julianday(due_at) - julianday(updated_at))),
          last_review = updated_at
      WHERE repetitions > 0
    `);
  }
};

const migrateItems = (db: Database.Database) => {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const additions = [
    ["preference", "TEXT NOT NULL DEFAULT 'neutral' CHECK (preference IN ('like', 'neutral', 'dislike'))"],
    ["focus_terms", "TEXT NOT NULL DEFAULT '[]'"],
    ["frequency_band", "TEXT NOT NULL DEFAULT 'common' CHECK (frequency_band IN ('core', 'common', 'specific', 'rare'))"],
    ["currency", "TEXT NOT NULL DEFAULT 'current' CHECK (currency IN ('current', 'contextual', 'dated', 'uncertain'))"],
    ["persona_fit", "INTEGER NOT NULL DEFAULT 5 CHECK (persona_fit BETWEEN 1 AND 5)"],
    ["relevance_checked_at", "TEXT"],
    ["practice_enabled", "INTEGER NOT NULL DEFAULT 1 CHECK (practice_enabled IN (0, 1))"],
  ] as const;
  for (const [name, definition] of additions) {
    if (columns.has(name)) continue;
    db.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
  }
};

export const openDatabase = (databasePath = config.databasePath) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(schema);
  migrateItems(db);
  migrateReviewState(db);
  db.prepare(
    "INSERT OR IGNORE INTO languages(code, name, locale) VALUES (?, ?, ?)",
  ).run("en", "English", "en-US");
  db.prepare(
    "INSERT OR IGNORE INTO languages(code, name, locale) VALUES (?, ?, ?)",
  ).run("lv", "Latviešu", "lv-LV");
  return db;
};

export type RehearsalDatabase = ReturnType<typeof openDatabase>;
