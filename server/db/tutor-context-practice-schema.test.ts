import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { openDatabase } from "./database.js";

describe("context practice additive migration", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());

  it("migrates a populated v16 database copy once without changing cards, FSRS, history or progress", async () => {
    const card = context.repository.items.list("en", 1)[0];
    context.repository.practice.recordAttempt({ itemPublicId: card.publicId, mode: "recall", answer: card.target,
      score: 1, verdict: "good", rating: "good", feedback: {}, reviewedAt: new Date("2026-09-01T00:00:00Z") });
    context.db.exec("DROP TABLE tutor_context_attempts; DELETE FROM schema_migrations WHERE id='017-tutor-context-practice'");
    const tables = ["items", "review_state", "attempts", "pilot_card_progress", "pilot_events", "pilot_listens", "chat_messages"];
    const snapshot = (db: Database.Database) => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const before = snapshot(context.db);
    const copyPath = path.join(context.tempDir, "migration-copy.sqlite");
    await context.db.backup(copyPath);
    let copy = openDatabase(copyPath);
    try {
      expect(snapshot(copy)).toEqual(before);
      expect(copy.prepare("SELECT * FROM tutor_context_attempts").all()).toEqual([]);
      expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
      expect(copy.pragma("foreign_key_check")).toEqual([]);
      copy.close(); copy = openDatabase(copyPath);
      expect(snapshot(copy)).toEqual(before);
      expect(copy.prepare("SELECT id FROM schema_migrations WHERE id='017-tutor-context-practice'").all()).toHaveLength(1);
      expect(context.db.prepare("SELECT name FROM sqlite_master WHERE name='tutor_context_attempts'").get()).toBeUndefined();
    } finally { copy.close(); fs.rmSync(copyPath); }
  });

  it("rolls back the new table when migration fails, leaving the previous database usable", () => {
    context.db.exec("DROP TABLE tutor_context_attempts; DELETE FROM schema_migrations WHERE id='017-tutor-context-practice'");
    context.db.exec("CREATE TABLE idx_tutor_context_attempts_target (id INTEGER)");
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all();
    context.db.close();
    expect(() => openDatabase(context.databasePath)).toThrow();
    const copy = new Database(context.databasePath);
    try {
      expect(copy.prepare("SELECT name FROM sqlite_master WHERE name='tutor_context_attempts'").get()).toBeUndefined();
      expect(copy.prepare("SELECT id FROM schema_migrations WHERE id='017-tutor-context-practice'").get()).toBeUndefined();
      expect(copy.prepare("SELECT * FROM review_state ORDER BY item_id").all()).toEqual(before);
      expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
    } finally { copy.close(); }
  });
});
