import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { schema } from "./schema.js";

const migrateReviewBatches = (db: Database.Database) => {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_batches'",
  ).get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'capture'")) return;

  db.pragma("foreign_keys = OFF");
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE review_batches_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        language_code TEXT NOT NULL REFERENCES languages(code),
        kind TEXT NOT NULL CHECK (kind IN ('chat_review', 'vocab', 'text_import', 'pattern_drill', 'capture')),
        title TEXT NOT NULL,
        source_text TEXT NOT NULL DEFAULT '',
        candidates TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'committed')),
        source_thread_public_id TEXT,
        committed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO review_batches_next(
        id, public_id, language_code, kind, title, source_text, candidates, status,
        source_thread_public_id, committed_at, created_at, updated_at
      )
      SELECT id, public_id, language_code, kind, title, source_text, candidates, status,
        source_thread_public_id, committed_at, created_at, updated_at
      FROM review_batches;
      DROP TABLE review_batches;
      ALTER TABLE review_batches_next RENAME TO review_batches;
      CREATE INDEX idx_review_batches_status ON review_batches(status, updated_at DESC);
    `);
  });
  migrate();
  db.pragma("foreign_keys = ON");
};

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

const removeLegacyContinuousTrackStorage = (db: Database.Database) => {
  db.prepare("DELETE FROM audio_cache WHERE model = 'saturation-v1'").run();
  db.exec("DROP TABLE IF EXISTS saturation_tracks");
};

type SchemaMigration = {
  id: string;
  run: (db: Database.Database) => void;
  requiresForeignKeysOff?: boolean;
};

const schemaMigrations: SchemaMigration[] = [
  { id: "001-review-batches-capture", run: migrateReviewBatches, requiresForeignKeysOff: true },
  { id: "002-items-metadata", run: migrateItems },
  { id: "003-review-state-fsrs", run: migrateReviewState },
  { id: "004-remove-saturation-storage", run: removeLegacyContinuousTrackStorage },
];

const assertForeignKeys = (db: Database.Database) => {
  const failures = db.pragma("foreign_key_check") as unknown[];
  if (failures.length) throw new Error("SQLite foreign_key_check failed after schema migration");
};

const applySchemaMigrations = (db: Database.Database) => {
  const hasMigration = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const markMigration = db.prepare("INSERT INTO schema_migrations(id) VALUES (?)");

  for (const migration of schemaMigrations) {
    if (hasMigration.get(migration.id)) continue;
    if (migration.requiresForeignKeysOff) db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        migration.run(db);
        assertForeignKeys(db);
        markMigration.run(migration.id);
      })();
    } finally {
      if (migration.requiresForeignKeysOff) db.pragma("foreign_keys = ON");
    }
  }
};

export const openDatabase = (databasePath = config.databasePath) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.exec(schema);
    applySchemaMigrations(db);
    db.prepare(
      "INSERT OR IGNORE INTO languages(code, name, locale) VALUES (?, ?, ?)",
    ).run("en", "English", "en-US");
    db.prepare(
      "INSERT OR IGNORE INTO languages(code, name, locale) VALUES (?, ?, ?)",
    ).run("lv", "Latviešu", "lv-LV");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

export type RehearsalDatabase = ReturnType<typeof openDatabase>;
