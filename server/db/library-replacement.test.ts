import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type RehearsalDatabase } from "./database.js";
import { libraryReplacementSchema, replaceLibrary } from "./library-replacement.js";
import { RehearsalRepository } from "./repository.js";

describe("Library replacement", () => {
  let directory: string;
  let db: RehearsalDatabase;
  let repository: RehearsalRepository;
  let oldEnglishId: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-replace-library-"));
    db = openDatabase(path.join(directory, "roman.sqlite"));
    repository = new RehearsalRepository(db);
    const oldEnglish = repository.items.save({ language: "en", cue: "Старое", target: "Old card." });
    oldEnglishId = oldEnglish.publicId;
    const latvian = repository.items.save({ language: "lv", cue: "Привет", target: "Sveiki!" });
    repository.library.createIsland({ language: "en", title: "Old", itemPublicIds: [oldEnglish.publicId] });
    repository.library.createIsland({ language: "lv", title: "Latvian", itemPublicIds: [latvian.publicId] });
    db.prepare("INSERT INTO chat_threads(public_id, language_code, title) VALUES (?, 'en', 'Keep me')")
      .run("00000000-0000-4000-8000-000000000001");
    db.prepare("INSERT INTO capture_notes(public_id, language_code, transcript, status) VALUES (?, 'en', 'Keep me', 'ready')")
      .run("00000000-0000-4000-8000-000000000002");
  });

  afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  it("atomically replaces one language while preserving the rest of the profile", () => {
    const input = libraryReplacementSchema.parse({
      version: 1,
      language: "en",
      title: "Curated import",
      generatedAt: "2026-08-20T12:00:00.000Z",
      cards: [
        { target: "Could you say that again?", cue: "Можешь повторить?", note: "", category: "Conversation", focusTerms: [], frequencyBand: "core", naturalness: 5, commonness: 5, personaFit: 5 },
        { target: "I need some time to think it over.", cue: "Мне нужно время, чтобы всё обдумать.", note: "", category: "Decisions", focusTerms: ["think it over"], frequencyBand: "common", naturalness: 5, commonness: 5, personaFit: 5 },
      ],
    });
    expect(replaceLibrary(db, input)).toEqual({
      before: { items: 1, topics: 1 },
      after: { items: 2, topics: 2 },
    });
    expect(repository.items.get(oldEnglishId)).toBeNull();
    expect(repository.items.list("en", 10).map((item) => item.target).sort()).toEqual([
      "Could you say that again?",
      "I need some time to think it over.",
    ]);
    expect(repository.items.list("lv", 10).map((item) => item.target)).toEqual(["Sveiki!"]);
    expect(repository.library.listIslands("lv")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM chat_threads").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM capture_notes").get()).toEqual({ count: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects duplicate targets before touching the database", () => {
    const parse = () => libraryReplacementSchema.parse({
      version: 1,
      language: "en",
      title: "Invalid import",
      generatedAt: "2026-08-20T12:00:00.000Z",
      cards: [
        { target: "Same card.", cue: "Первая.", category: "One", frequencyBand: "core", naturalness: 5, commonness: 5, personaFit: 5 },
        { target: "Same card!", cue: "Вторая.", category: "Two", frequencyBand: "core", naturalness: 5, commonness: 5, personaFit: 5 },
      ],
    });
    expect(parse).toThrow("Duplicate normalized target");
    expect(repository.items.list("en", 10).map((item) => item.target)).toEqual(["Old card."]);
  });
});
