import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { InjectOptions, Response as InjectResponse } from "light-my-request";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import { seedDatabase } from "../db/seed.js";
import { ProfileManager, type ProfileId } from "./manager.js";

const pins = { roman: "1234", oliver: "5678" };
const sessionSecret = "test-session-secret-with-more-than-thirty-two-bytes";

type LoginSession = { cookie: string; csrfToken: string };

const cookieHeader = (response: InjectResponse) =>
  response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

const login = async (app: FastifyInstance, profileId: ProfileId, pin = pins[profileId]) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-rehearsal-client": "web" },
    payload: { profileId, pin },
  });
  return {
    response,
    session: response.statusCode === 200
      ? { cookie: cookieHeader(response), csrfToken: response.json().csrfToken } as LoginSession
      : null,
  };
};

const mutate = (
  app: FastifyInstance,
  session: LoginSession,
  input: InjectOptions,
) => app.inject({
  ...input,
  headers: {
    ...input.headers,
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
    "x-rehearsal-client": "web",
  },
});

const read = (
  app: FastifyInstance,
  session: LoginSession,
  url: string,
) => app.inject({ method: "GET", url, headers: { cookie: session.cookie } });

describe("profile authentication and database isolation", () => {
  let tempDir: string;
  let dataDir: string;
  let backupDir: string;
  let legacyPath: string;
  let manager: ProfileManager;
  let app: FastifyInstance;
  let initialEnglishItems: number;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-profiles-test-"));
    dataDir = path.join(tempDir, "data");
    backupDir = path.join(tempDir, "backups");
    legacyPath = path.join(dataDir, "rehearsal.sqlite");
    const legacyDb = openDatabase(legacyPath);
    const legacyRepository = new RehearsalRepository(legacyDb);
    seedDatabase(legacyRepository);
    initialEnglishItems = legacyRepository.items.list("en", 500).length;
    legacyDb.close();

    manager = await ProfileManager.create({
      dataDir,
      backupDir,
      legacyDatabasePath: legacyPath,
      pins,
    });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });
  });

  afterEach(async () => {
    await app.close();
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies and verifies the legacy database for both profiles without exposing data in health", async () => {
    expect(manager.get("roman").repository.items.list("en", 500)).toHaveLength(initialEnglishItems);
    expect(manager.get("oliver").repository.items.list("en", 500)).toHaveLength(initialEnglishItems);
    expect(fs.readdirSync(backupDir).some((name) => name.startsWith("legacy-before-profiles-"))).toBe(true);
    const migration = JSON.parse(fs.readFileSync(path.join(dataDir, "profiles", "migration.json"), "utf8")) as {
      profiles: ProfileId[];
      counts: Record<string, number>;
    };
    expect(migration.profiles).toEqual(["roman", "oliver"]);
    expect(Object.keys(migration.counts)).toEqual([
      "languages", "sources", "items", "items_fts", "islands", "island_items",
      "attempts", "review_state", "chat_threads", "chat_messages", "review_batches",
      "change_events", "app_settings", "audio_cache", "capture_notes",
    ]);
    expect(migration.counts.items).toBeGreaterThan(0);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().profiles).toEqual([
      { id: "roman", ok: true },
      { id: "oliver", ok: true },
    ]);
    expect(JSON.stringify(health.json())).not.toContain("drawn to");
  });

  it("rejects bad PINs, protects APIs, and sets a hardened 30-day cookie", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/items?language=en" });
    expect(anonymous.statusCode).toBe(401);

    const tooShort = await login(app, "roman", "999");
    expect(tooShort.response.statusCode).toBe(400);

    const invalid = await login(app, "roman", "9999");
    expect(invalid.response.statusCode).toBe(401);

    const authenticated = await login(app, "roman");
    expect(authenticated.response.statusCode).toBe(200);
    expect(authenticated.session).toBeTruthy();
    const setCookies = authenticated.response.headers["set-cookie"];
    const serialized = Array.isArray(setCookies) ? setCookies.join("\n") : String(setCookies);
    expect(serialized).toContain("rehearsal_session=");
    expect(serialized).toContain("HttpOnly");
    expect(serialized).toContain("Secure");
    expect(serialized).toContain("SameSite=Strict");
    expect(serialized).toContain("Max-Age=2592000");

    const missingCsrf = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to/preference",
      headers: { cookie: authenticated.session!.cookie, "x-rehearsal-client": "web" },
      payload: { preference: "like" },
    });
    expect(missingCsrf.statusCode).toBe(403);
  });

  it("isolates cards, progress, settings, and Tutor threads in both directions", async () => {
    const roman = (await login(app, "roman")).session!;
    const oliver = (await login(app, "oliver")).session!;

    expect((await mutate(app, roman, {
      method: "PATCH",
      url: "/api/items/en-drawn-to/preference",
      payload: { preference: "like" },
    })).statusCode).toBe(200);
    expect((await mutate(app, roman, {
      method: "PATCH",
      url: "/api/settings/scheduler",
      payload: {
        presets: {
          like: { requestRetention: 0.94, maximumInterval: 45 },
          neutral: { requestRetention: 0.91, maximumInterval: 150 },
          dislike: { requestRetention: 0.86, maximumInterval: 320 },
        },
        learningSteps: ["2m", "12m"],
        relearningSteps: ["2m", "12m"],
        fuzz: false,
        newItemsPerDay: 7,
      },
    })).statusCode).toBe(200);
    expect((await mutate(app, roman, {
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
        rating: "easy",
      },
    })).statusCode).toBe(200);
    expect((await mutate(app, roman, {
      method: "POST",
      url: "/api/chat",
      payload: { language: "en", message: "Roman private thread" },
    })).statusCode).toBe(200);

    const oliverItems = await read(app, oliver, "/api/items?language=en&limit=500");
    expect(oliverItems.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to").preference)
      .toBe("neutral");
    expect((await read(app, oliver, "/api/config")).json().scheduler.newItemsPerDay).toBe(10);
    expect((await read(app, oliver, "/api/chat/threads?language=en")).json().threads).toEqual([]);
    expect((await read(app, oliver, "/api/practice/progress?language=en&since=2000-01-01T00:00:00.000Z"))
      .json().recall).toBe(0);

    expect((await mutate(app, oliver, {
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: { target: "Oliver owns this edit." },
    })).statusCode).toBe(200);
    const romanItems = await read(app, roman, "/api/items?language=en&limit=500");
    expect(romanItems.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to").target)
      .not.toBe("Oliver owns this edit.");
  });

  it("limits failed attempts per IP and profile and preserves existing profile databases", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login(app, "roman", "9999")).response.statusCode).toBe(401);
    }
    expect((await login(app, "roman", "9999")).response.statusCode).toBe(429);
    expect((await login(app, "oliver", "9999")).response.statusCode).toBe(401);

    manager.get("oliver").repository.items.update("en-drawn-to", { target: "Persistent Oliver edit." });
    await app.close();
    manager.close();
    manager = await ProfileManager.create({
      dataDir,
      backupDir,
      legacyDatabasePath: legacyPath,
      pins: { roman: "", oliver: "" },
    });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });
    expect(manager.get("oliver").repository.items.get("en-drawn-to")?.target).toBe("Persistent Oliver edit.");
  });
});
