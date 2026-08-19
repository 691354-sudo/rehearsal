import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("database migrations", () => {
  it("upgrades legacy review rows without losing their due date", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-migration-"));
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        language_code TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'phrase',
        cue TEXT NOT NULL,
        target TEXT NOT NULL,
        accepted_answers TEXT NOT NULL DEFAULT '[]',
        note TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        source_id INTEGER,
        status TEXT NOT NULL DEFAULT 'new',
        naturalness INTEGER NOT NULL DEFAULT 5,
        commonness INTEGER NOT NULL DEFAULT 5,
        register TEXT NOT NULL DEFAULT 'neutral',
        tags TEXT NOT NULL DEFAULT '[]',
        embedding BLOB,
        embedding_model TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO items(public_id, language_code, cue, target)
      VALUES ('legacy-item', 'en', 'Старая карточка', 'Legacy card');
      CREATE TABLE review_state (
        item_id INTEGER PRIMARY KEY,
        due_at TEXT NOT NULL,
        repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        ease REAL NOT NULL DEFAULT 2.5,
        last_score REAL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO review_state(item_id, due_at, repetitions, updated_at)
      VALUES (1, '2026-08-25T12:00:00.000Z', 3, '2026-08-18T12:00:00.000Z');
    `);
    legacy.close();

    const migrated = openDatabase(databasePath);
    const columns = migrated.prepare("PRAGMA table_info(review_state)").all() as Array<{ name: string }>;
    const row = migrated.prepare("SELECT * FROM review_state WHERE item_id = 1").get() as {
      due_at: string; state: number; stability: number; scheduled_days: number;
    };
    const item = migrated.prepare("SELECT preference, frequency_band, practice_enabled FROM items WHERE id = 1").get() as {
      preference: string; frequency_band: string; practice_enabled: number;
    };

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "state", "stability", "difficulty", "scheduled_days", "learning_steps", "last_review",
    ]));
    expect(row.due_at).toBe("2026-08-25T12:00:00.000Z");
    expect(row.state).toBe(2);
    expect(row.stability).toBe(7);
    expect(row.scheduled_days).toBe(7);
    expect(item.preference).toBe("neutral");
    expect(item.frequency_band).toBe("common");
    expect(item.practice_enabled).toBe(1);

    migrated.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("expands legacy review batch kinds for Capture Reality without losing drafts", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-capture-migration-"));
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE languages(code TEXT PRIMARY KEY, name TEXT NOT NULL, locale TEXT NOT NULL);
      INSERT INTO languages VALUES ('en', 'English', 'en-US');
      CREATE TABLE review_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        language_code TEXT NOT NULL REFERENCES languages(code),
        kind TEXT NOT NULL CHECK (kind IN ('chat_review', 'vocab', 'text_import', 'pattern_drill')),
        title TEXT NOT NULL,
        source_text TEXT NOT NULL DEFAULT '',
        candidates TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'committed')),
        source_thread_public_id TEXT,
        committed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO review_batches(public_id, language_code, kind, title)
      VALUES ('legacy-batch', 'en', 'vocab', 'Existing draft');
    `);
    legacy.close();

    const migrated = openDatabase(databasePath);
    expect(migrated.prepare("SELECT title FROM review_batches WHERE public_id = 'legacy-batch'").get())
      .toEqual({ title: "Existing draft" });
    expect(() => migrated.prepare(
      "INSERT INTO review_batches(public_id, language_code, kind, title) VALUES (?, ?, ?, ?)",
    ).run("capture-batch", "en", "capture", "Capture Reality")).not.toThrow();
    const columns = migrated.prepare("PRAGMA table_info(capture_notes)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "transcript", "audio", "status", "review_batch_id", "processed_at",
    ]));

    migrated.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
