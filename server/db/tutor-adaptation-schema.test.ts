import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { createApiTestContext } from "../testing/api-test-context.js";
import { openDatabase } from "./database.js";

const newTables = ["tutor_learning_profiles", "tutor_adaptation_sessions", "tutor_adaptation_thread_settings", "tutor_adaptation_events"];
it("migrates a populated v17 backup once and retains every existing table for code rollback", async () => {
  const context = createApiTestContext();
  try {
    const item = context.repository.items.list("en", 1)[0];
    context.repository.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: item.target,
      score: 1, verdict: "good", rating: "good", feedback: {}, reviewedAt: new Date("2026-09-01T00:00:00Z") });
    const thread = context.repository.tutor.getOrCreateThread(undefined, "en");
    context.repository.tutor.addMessage(thread.id, "user", "Existing history");
    for (const table of newTables) context.db.exec(`DROP TABLE ${table}`);
    context.db.prepare("DELETE FROM schema_migrations WHERE id = '018-tutor-adaptation'").run();
    const tables = (context.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'").all() as { name: string }[]).map(({ name }) => name);
    const snapshot = (db: Database.Database) => Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all().map((row) => JSON.stringify(row)).sort()]));
    const before = snapshot(context.db); const copyPath = path.join(context.tempDir, "v17-copy.sqlite");
    await context.db.backup(copyPath);
    let copy = openDatabase(copyPath);
    try {
      expect(snapshot(copy)).toEqual(before);
      for (const table of newTables) expect(copy.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
      expect(copy.pragma("quick_check", { simple: true })).toBe("ok"); expect(copy.pragma("foreign_key_check")).toEqual([]);
      copy.close(); copy = openDatabase(copyPath);
      expect(snapshot(copy)).toEqual(before);
      expect(copy.prepare("SELECT id FROM schema_migrations WHERE id='018-tutor-adaptation'").all()).toHaveLength(1);
    } finally { copy.close(); fs.rmSync(copyPath); }
  } finally { context.close(); }
});

it("rolls back all new tables if the additive migration fails", () => {
  const context = createApiTestContext();
  try {
    for (const table of newTables) context.db.exec(`DROP TABLE ${table}`);
    context.db.prepare("DELETE FROM schema_migrations WHERE id = '018-tutor-adaptation'").run();
    context.db.exec("CREATE TABLE tutor_adaptation_event_period(id INTEGER)");
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all(); context.db.close();
    expect(() => openDatabase(context.databasePath)).toThrow();
    const copy = new Database(context.databasePath);
    try {
      for (const table of newTables) expect(copy.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table)).toBeUndefined();
      expect(copy.prepare("SELECT id FROM schema_migrations WHERE id='018-tutor-adaptation'").get()).toBeUndefined();
      expect(copy.prepare("SELECT * FROM review_state ORDER BY item_id").all()).toEqual(before);
      expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
    } finally { copy.close(); }
  } finally { context.close(); }
});
