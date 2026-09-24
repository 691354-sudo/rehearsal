import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createApiTestContext } from "../testing/api-test-context.js";

it("upgrades existing language constraints without changing learning data or enabled languages", () => {
  const context = createApiTestContext();
  try {
    const repo = context.repository, db = context.db;
    const card = repo.items.list("en")[0];
    repo.pilot.listening.complete({ eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(),
      language: "en", cardId: card.publicId, completedAt: new Date().toISOString(), audioRepeatsInAppearance: 1 });
    const tables = ["items", "attempts", "review_state", "pilot_events", "pilot_listens", "pilot_card_progress", "islands", "island_items"];
    const snapshot = () => tables.map((table) => context.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot();
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.prepare("DELETE FROM languages WHERE code='de'").run();
      for (const table of ["languages", "pilot_events", "pilot_homework"]) {
        const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string };
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table) as { sql: string }[];
        db.exec(sql.replace(/CREATE TABLE\s+"?\w+"?/, `CREATE TABLE ${table}_old`).replace(/,\s*'de'/g, ""));
        db.exec(`INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table};`);
        for (const index of indexes) db.exec(index.sql);
      }
      db.prepare("DELETE FROM schema_migrations WHERE id='016-german-language'").run();
    })();
    db.pragma("foreign_keys = ON");
    const enabled = repo.system.listLanguages();
    context.reopen();
    expect(snapshot()).toEqual(before);
    expect(context.repository.system.listLanguages()).toEqual(enabled);
    expect(context.repository.system.isLanguageEnabled("de")).toBe(false);
    expect(context.db.pragma("foreign_key_check")).toEqual([]);
    expect(context.db.pragma("quick_check", { simple: true })).toBe("ok");
    context.repository.system.setLanguageEnabled("de", true);
    context.reopen();
    expect(context.repository.system.isLanguageEnabled("de")).toBe(true);
    expect(snapshot()).toEqual(before);
  } finally { context.close(); }
});
