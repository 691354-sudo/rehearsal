import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LanguageCode } from "../../contracts/api.js";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import {
  completePilotOnboarding,
  getPilotOnboardingState,
  pilotStarterIds,
  seedPilotOnboarding,
} from "./pilot.js";

const expectedTargets: Record<LanguageCode, string[]> = {
  en: [
    "Could I have a latte, please?", "Could I have it with oat milk?", "I’ll have it to go.",
    "I need to reschedule the parcel delivery.", "Could you deliver it on Friday?", "I’ll be home after six.",
  ],
  lv: [
    "Vienu latte, lūdzu.", "Vai var ar auzu pienu?", "Es ņemšu līdzi.",
    "Man jāpārceļ sūtījuma piegāde.", "Vai varat piegādāt piektdien?", "Pēc sešiem būšu mājās.",
  ],
  vi: [
    "Cho tôi một ly latte, làm ơn.", "Tôi có thể đổi sang sữa yến mạch không?", "Tôi muốn mang đi.",
    "Tôi cần đổi lịch giao bưu kiện.", "Có thể giao vào thứ Sáu được không?", "Sau sáu giờ tôi sẽ ở nhà.",
  ],
  no: [
    "Kan jeg få en latte, takk?", "Kan jeg få den med havremelk?", "Jeg tar den med.",
    "Jeg må endre leveringsdatoen for pakken.", "Kan dere levere på fredag?", "Jeg er hjemme etter klokken seks.",
  ],
};

describe("pilot onboarding workspace", () => {
  const temporaryDirectories: string[] = [];
  let db: RehearsalDatabase | null = null;

  const freshDatabase = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-onboarding-test-"));
    temporaryDirectories.push(directory);
    db = openDatabase(path.join(directory, "pilot.sqlite"));
    return db;
  };

  afterEach(() => {
    db?.close();
    db = null;
    temporaryDirectories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it.each(Object.keys(expectedTargets) as LanguageCode[])("creates real isolated starter data for %s", (language) => {
    const database = freshDatabase();
    database.prepare("UPDATE languages SET enabled = CASE WHEN code = ? THEN 1 ELSE 0 END").run(language);

    expect(seedPilotOnboarding(database, language)).toMatchObject({
      eligibility: "pilot", status: "pending", language, starterReady: true,
    });
    expect((database.prepare("SELECT target FROM items ORDER BY id").all() as Array<{ target: string }>)
      .map((row) => row.target)).toEqual(expectedTargets[language]);
    expect(database.prepare("SELECT title FROM islands ORDER BY id").all()).toEqual([
      { title: "Заказываем кофе" }, { title: "Доставка посылки" },
    ]);
    expect(database.prepare("SELECT title FROM chat_threads").get()).toEqual({ title: "Пример: заказываем кофе" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM chat_messages").get()).toEqual({ count: 7 });
    expect(database.prepare("SELECT status, COUNT(*) AS count FROM capture_notes GROUP BY status").all())
      .toEqual([{ status: "processed", count: 2 }]);
    expect(database.prepare("SELECT kind, status FROM review_batches ORDER BY id").all()).toEqual([
      { kind: "chat_review", status: "committed" }, { kind: "capture", status: "committed" },
    ]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM items_fts").get()).toEqual({ count: 6 });

    expect(seedPilotOnboarding(database, language)).toMatchObject({ status: "pending" });
    expect(database.prepare("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 6 });
  });

  it("completes idempotently and never restores deleted starter cards", () => {
    const database = freshDatabase();
    seedPilotOnboarding(database, "en");
    const completed = completePilotOnboarding(database);
    expect(completed).toMatchObject({ status: "completed", completedAt: expect.any(String) });
    expect(completePilotOnboarding(database)).toEqual(completed);

    database.prepare("DELETE FROM items WHERE public_id = ?").run(pilotStarterIds.cards[0]);
    expect(seedPilotOnboarding(database, "en")).toEqual(completed);
    expect(database.prepare("SELECT COUNT(*) AS count FROM items").get()).toEqual({ count: 5 });
    expect(getPilotOnboardingState(database)).toEqual(completed);
  });

  it("rolls back every starter table when seeding fails", () => {
    const database = freshDatabase();
    database.exec(`CREATE TRIGGER reject_pilot_items BEFORE INSERT ON items
      BEGIN SELECT RAISE(ABORT, 'seed rejected'); END;`);
    expect(() => seedPilotOnboarding(database, "en")).toThrow("seed rejected");
    for (const table of ["items", "islands", "chat_threads", "chat_messages", "review_batches", "capture_notes", "app_settings"]) {
      expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(), table).toEqual({ count: 0 });
    }
  });
});
