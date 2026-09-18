import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { migrateLearningPilot } from "./pilot-schema.js";
import { openDatabase } from "./database.js";

// A real v14 pilot schema, including its English-only constraints and mirrored events.
function restoreV14(context: ApiTestContext) {
  const db = context.db;
  db.pragma("foreign_keys=OFF");
  db.exec("DROP TRIGGER learning_new_card; DROP TABLE practice_sessions; DROP TABLE tutor_core_links;");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pilot_%'").all() as { name: string }[];
  for (const { name } of tables) db.exec(`DROP TABLE ${name}`);
  migrateLearningPilot(db);
  db.prepare("DELETE FROM schema_migrations WHERE id='015-unified-learning'").run();
  db.pragma("foreign_keys=ON");
}

describe("unified learning migration", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); restoreV14(context); });
  afterEach(() => context.close());
  const dbRows = (table: string) => context.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

  it("merges historical listens once, preserves all FSRS rows and starts fresh transition streaks", () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "en", title: "Migration fixture" });
    const listened = repo.items.create({ language: "en", cue: "Слушали", target: "Listened." }, topic.publicId);
    const reviewed = repo.items.create({ language: "en", cue: "Вспоминали", target: "Reviewed." }, topic.publicId);
    const oldCounter = repo.items.create({ language: "en", cue: "Счётчик", target: "Counter." }, topic.publicId);
    repo.items.update(oldCounter.publicId, { practiceEnabled: false });
    const eventId = randomUUID();
    const recordedAt = "2026-09-01T10:00:00.000Z";
    context.db.prepare("INSERT INTO pilot_events VALUES(?,'en','listen_appearance_completed',?,?,?,'old','v1','{}')")
      .run(eventId, listened.publicId, recordedAt, recordedAt);
    context.db.prepare("INSERT INTO pilot_listens VALUES(?,?,?,?,1,0)").run(randomUUID(), eventId, listened.publicId, recordedAt);
    for (let n = 0; n < 5; n++) repo.practice.recordAttempt({ itemPublicId: listened.publicId, publicId: n ? randomUUID() : eventId,
      mode: n % 2 ? "shadow" : "listen", answer: "", score: 1, verdict: "good", feedback: {}, reviewedAt: new Date(recordedAt) });
    context.db.prepare("INSERT INTO pilot_card_progress(card_id,listen_count) VALUES(?,8)").run(oldCounter.publicId);
    for (const rating of ["good", "good"] as const) repo.practice.recordAttempt({ itemPublicId: reviewed.publicId,
      mode: "recall", answer: "", score: 1, verdict: rating, rating, feedback: {}, reviewedAt: new Date(recordedAt) });
    const before = { reviews: dbRows("review_state"), attempts: dbRows("attempts"), listens: dbRows("pilot_listens"), events: dbRows("pilot_events") };
    context.reopen();
    expect(dbRows("review_state")).toEqual(before.reviews);
    expect(dbRows("attempts")).toEqual(before.attempts);
    expect(dbRows("pilot_listens")).toEqual(before.listens);
    expect(dbRows("pilot_events")).toEqual(before.events);
    expect(context.repository.pilot.store.progress(listened.publicId)).toMatchObject({ listenCount: 5, learningStage: "recall" });
    expect(context.repository.pilot.store.progress(oldCounter.publicId).listenCount).toBe(8);
    expect(context.repository.items.get(oldCounter.publicId)?.practiceEnabled).toBe(false);
    expect(context.db.prepare("SELECT stage,last_rating,again_count FROM pilot_card_progress WHERE card_id=?").get(reviewed.publicId))
      .toEqual({ stage: "recall", last_rating: null, again_count: 0 });
    expect(context.db.prepare("SELECT DISTINCT stage FROM pilot_card_progress p JOIN items i ON i.public_id=p.card_id WHERE i.language_code='lv'").all())
      .toEqual([{ stage: "recall" }]);
    expect(context.db.pragma("foreign_key_check")).toEqual([]);
    expect(context.db.pragma("quick_check", { simple: true })).toBe("ok");
    const progress = dbRows("pilot_card_progress");
    context.reopen();
    expect(dbRows("pilot_card_progress")).toEqual(progress);
    expect(dbRows("review_state")).toEqual(before.reviews);
  });

  it("rolls back a failed migration without partial columns, lost events, or a version marker", () => {
    context.db.exec("DROP TRIGGER pilot_preference_unlike"); // Failure after table rebuild and ADD COLUMN.
    const before = dbRows("review_state");
    context.db.close();
    expect(() => openDatabase(context.databasePath)).toThrow("no such trigger");
    const failed = new Database(context.databasePath);
    try {
      expect(failed.prepare("SELECT 1 FROM schema_migrations WHERE id='015-unified-learning'").get()).toBeUndefined();
      expect((failed.pragma("table_info(pilot_card_progress)") as { name: string }[]).map((c) => c.name)).not.toContain("stage");
      expect(failed.prepare("SELECT * FROM review_state ORDER BY rowid").all()).toEqual(before);
      expect(failed.pragma("foreign_key_check")).toEqual([]);
      expect(failed.prepare("SELECT sql FROM sqlite_master WHERE name='pilot_events'").get()).toMatchObject({ sql: expect.stringContaining("language = 'en'") });
    } finally { failed.close(); }
  });
});
