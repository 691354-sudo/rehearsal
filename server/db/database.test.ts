import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";
import { seedDatabase } from "./seed.js";

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
    expect(migrated.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toHaveLength(6);

    migrated.close();
    const reopened = openDatabase(databasePath);
    expect(reopened.prepare("SELECT id FROM schema_migrations ORDER BY id").all()).toHaveLength(6);
    expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);

    reopened.close();
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

  it("removes legacy continuous tracks without deleting reusable phrase audio", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-drill-migration-"));
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE audio_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        voice TEXT NOT NULL,
        format TEXT NOT NULL,
        audio BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO audio_cache(cache_key, model, voice, format, audio)
      VALUES ('phrase', 'eleven_multilingual_v2', 'voice-id', 'mp3', X'0102');
      INSERT INTO audio_cache(cache_key, model, voice, format, audio)
      VALUES ('continuous', 'saturation-v1', 'voice-id', 'mp3', X'0304');
      CREATE TABLE saturation_tracks (id INTEGER PRIMARY KEY, public_id TEXT);
      INSERT INTO saturation_tracks VALUES (1, 'old-track');
    `);
    legacy.close();

    const migrated = openDatabase(databasePath);
    expect(migrated.prepare("SELECT cache_key FROM audio_cache ORDER BY cache_key").all())
      .toEqual([{ cache_key: "phrase" }]);
    expect(migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saturation_tracks'",
    ).get()).toBeUndefined();

    migrated.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rolls back a failed table rebuild instead of leaving partial migration state", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-failed-migration-"));
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE languages(code TEXT PRIMARY KEY, name TEXT NOT NULL, locale TEXT NOT NULL);
      CREATE TABLE review_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        language_code TEXT NOT NULL REFERENCES languages(code),
        kind TEXT NOT NULL CHECK (kind IN ('chat_review', 'vocab')),
        title TEXT NOT NULL,
        source_text TEXT NOT NULL DEFAULT '',
        candidates TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        source_thread_public_id TEXT,
        committed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE review_batches_next(id INTEGER PRIMARY KEY);
    `);
    legacy.close();

    expect(() => openDatabase(databasePath)).toThrow();
    const inspected = new Database(databasePath);
    expect(inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'review_batches'").get())
      .toBeTruthy();
    expect(inspected.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001-review-batches-capture"))
      .toBeUndefined();
    inspected.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds disabled Vietnamese without changing existing data counters", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-vietnamese-migration-"));
    const databasePath = path.join(tempDir, "legacy.sqlite");
    const prepared = openDatabase(databasePath);
    const repository = new RehearsalRepository(prepared);
    seedDatabase(repository);
    repository.capture.createText({ language: "en", transcript: "A saved capture" });
    repository.reviews.create({
      language: "en", kind: "vocab", title: "Saved review", candidates: [],
    });
    const countedTables = [
      "sources", "items", "items_fts", "islands", "island_items", "attempts", "review_state",
      "chat_threads", "chat_messages", "review_batches", "capture_notes", "change_events",
      "app_settings", "audio_cache",
    ];
    const before = Object.fromEntries(countedTables.map((table) => [table,
      (prepared.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]));

    prepared.pragma("foreign_keys = OFF");
    prepared.transaction(() => {
      prepared.exec(`
        CREATE TABLE languages_legacy (
          code TEXT PRIMARY KEY CHECK (code IN ('en', 'lv')),
          name TEXT NOT NULL,
          locale TEXT NOT NULL,
          cue_locale TEXT NOT NULL DEFAULT 'ru-RU',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO languages_legacy(code, name, locale, cue_locale, created_at)
        SELECT code, name, locale, cue_locale, created_at FROM languages WHERE code IN ('en', 'lv');
        DROP TABLE languages;
        ALTER TABLE languages_legacy RENAME TO languages;
        DELETE FROM schema_migrations WHERE id = '005-vietnamese-language';
      `);
    })();
    prepared.pragma("foreign_keys = ON");
    prepared.close();

    const migrated = openDatabase(databasePath);
    const after = Object.fromEntries(countedTables.map((table) => [table,
      (migrated.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]));
    expect(after).toEqual(before);
    expect(migrated.prepare("SELECT code, name, locale, enabled FROM languages ORDER BY code").all())
      .toEqual([
        { code: "en", name: "English", locale: "en-US", enabled: 1 },
        { code: "lv", name: "Latviešu", locale: "lv-LV", enabled: 1 },
        { code: "vi", name: "Vietnamese", locale: "vi-VN", enabled: 0 },
      ]);
    expect(migrated.pragma("foreign_key_check")).toEqual([]);
    expect(migrated.pragma("quick_check", { simple: true })).toBe("ok");

    migrated.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
