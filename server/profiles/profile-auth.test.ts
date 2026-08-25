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
import { ProfileManager, registeredProfilesFromDisk, type ProfileId } from "./manager.js";

const pins = { roman: "1234", oliver: "5678", zanna: "2345" };
const sessionSecret = "test-session-secret-with-more-than-thirty-two-bytes";

type LoginSession = { cookie: string; csrfToken: string };

const cookieHeader = (response: InjectResponse) =>
  response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

const login = async (app: FastifyInstance, profileId: ProfileId, pin?: string) => {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "x-rehearsal-client": "web" },
    payload: { profileId, pin: pin ?? pins[profileId as keyof typeof pins] ?? "" },
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
    expect(manager.get("zanna").repository.items.list("en", 500)).toEqual([]);
    expect(manager.get("roman").repository.system.isLanguageEnabled("vi")).toBe(false);
    expect(manager.get("oliver").repository.system.isLanguageEnabled("vi")).toBe(false);
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
      { id: "zanna", ok: true },
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
      payload: { language: "en", message: "Roman private thread", clientMessageId: "e59fda18-738a-4b8f-832c-e111831c5f07" },
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
      pins: { roman: "", oliver: "", zanna: "" },
    });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });
    expect(manager.get("oliver").repository.items.get("en-drawn-to")?.target).toBe("Persistent Oliver edit.");
  });

  it("fails closed when an initialized profile database disappears", async () => {
    await app.close();
    manager.close();
    fs.rmSync(path.join(dataDir, "profiles", "oliver.sqlite"));

    await expect(ProfileManager.create({
      dataDir,
      backupDir,
      legacyDatabasePath: legacyPath,
      pins,
    })).rejects.toThrow("Profile database missing after initialization: oliver");
  });

  it("creates all empty profile databases and records a fresh base initialization", async () => {
    await app.close();
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-fresh-profiles-test-"));
    dataDir = path.join(tempDir, "data");
    backupDir = path.join(tempDir, "backups");
    legacyPath = path.join(dataDir, "rehearsal.sqlite");

    manager = await ProfileManager.create({ dataDir, backupDir, legacyDatabasePath: legacyPath, pins });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });

    expect(manager.get("roman").repository.items.list("en", 500)).toEqual([]);
    expect(manager.get("oliver").repository.items.list("en", 500)).toEqual([]);
    expect(manager.get("zanna").repository.items.list("en", 500)).toEqual([]);
    const migration = JSON.parse(fs.readFileSync(path.join(dataDir, "profiles", "migration.json"), "utf8")) as {
      mode: string; source: string | null; profiles: ProfileId[];
    };
    expect(migration).toMatchObject({ mode: "fresh", source: null, profiles: ["roman", "oliver"] });
  });

  it("adds Zanna with an empty database beside an existing base registry", async () => {
    const zannaLogin = await login(app, "zanna");
    expect(zannaLogin.response.statusCode).toBe(200);
    expect(zannaLogin.response.json().profile).toEqual({ id: "zanna", name: "Zanna" });
    expect(manager.get("zanna").repository.items.list("en", 500)).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, "profiles", "additional-registry.json"))).toBe(true);
  });

  it("creates a one-time invitation and an empty language-isolated profile that survives restart", async () => {
    const roman = (await login(app, "roman")).session!;
    const invitation = await mutate(app, roman, { method: "POST", url: "/api/auth/invites" });
    expect(invitation.statusCode).toBe(200);
    const token = invitation.json().token as string;
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

    const available = await app.inject({ method: "GET", url: `/api/auth/invites/${token}` });
    expect(available.statusCode).toBe(200);
    expect(available.json().available).toBe(true);
    expect(available.json().experience).toBe("standard");
    expect(available.json().replayAvailable).toBe(false);
    expect(available.json().languages.map((language: { code: string }) => language.code)).toEqual(["en", "lv", "vi", "no"]);

    const shortPin = await app.inject({
      method: "POST", url: "/api/auth/join", headers: { "x-rehearsal-client": "web" },
      payload: { token, name: "Maya", pin: "123", language: "vi" },
    });
    expect(shortPin.statusCode).toBe(400);

    const joined = await app.inject({
      method: "POST", url: "/api/auth/join", headers: { "x-rehearsal-client": "web" },
      payload: { token, name: "Maya", pin: "246810", language: "vi" },
    });
    expect(joined.statusCode).toBe(200);
    const profile = joined.json().profile as { id: string; name: string };
    expect(profile.name).toBe("Maya");
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(joined.json().availableLanguages.map((language: { code: string }) => language.code)).toEqual(["vi"]);
    expect(joined.json().onboarding).toEqual({
      version: 1, eligibility: "none", status: "not_available", starterReady: false,
    });
    expect(manager.get(profile.id).repository.system.stats().items).toEqual([]);
    expect(manager.get(profile.id).repository.system.isLanguageEnabled("en")).toBe(false);
    expect(manager.get(profile.id).repository.system.isLanguageEnabled("lv")).toBe(false);
    expect(manager.get(profile.id).repository.system.isLanguageEnabled("vi")).toBe(true);
    expect(manager.get(profile.id).repository.system.isLanguageEnabled("no")).toBe(false);

    expect((await app.inject({ method: "GET", url: `/api/auth/invites/${token}` })).json().available).toBe(false);
    const reused = await app.inject({
      method: "POST", url: "/api/auth/join", headers: { "x-rehearsal-client": "web" },
      payload: { token, name: "Other", pin: "1234", language: "en" },
    });
    expect(reused.statusCode).toBe(410);
    expect((await app.inject({
      method: "POST", url: "/api/auth/pilot-replay", headers: { "x-rehearsal-client": "web" },
      payload: { token, pin: "246810" },
    })).statusCode).toBe(401);
    expect((await login(app, profile.id, "246810")).response.statusCode).toBe(200);
    expect(registeredProfilesFromDisk(dataDir).map((candidate) => candidate.id)).toContain(profile.id);

    await app.close();
    manager.close();
    manager = await ProfileManager.create({ dataDir, backupDir, legacyDatabasePath: legacyPath, pins });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });
    expect(manager.get(profile.id).repository.system.stats().items).toEqual([]);
    expect((await login(app, profile.id, "246810")).response.statusCode).toBe(200);
  });

  it("limits the onboarding pilot to one Roman-created invited profile", async () => {
    const roman = (await login(app, "roman")).session!;
    const oliver = (await login(app, "oliver")).session!;
    expect((await read(app, roman, "/api/onboarding")).json().onboarding).toEqual({
      version: 1, eligibility: "none", status: "not_available", starterReady: false,
    });
    expect((await mutate(app, roman, { method: "POST", url: "/api/onboarding/complete" })).statusCode).toBe(404);
    const forbidden = await mutate(app, oliver, {
      method: "POST", url: "/api/auth/invites", payload: { purpose: "onboarding_v1_pilot" },
    });
    expect(forbidden.statusCode).toBe(403);

    const first = await mutate(app, roman, {
      method: "POST", url: "/api/auth/invites", payload: { purpose: "onboarding_v1_pilot" },
    });
    const firstToken = first.json().token as string;
    const replacement = await mutate(app, roman, {
      method: "POST", url: "/api/auth/invites", payload: { purpose: "onboarding_v1_pilot" },
    });
    const token = replacement.json().token as string;
    expect((await app.inject({ method: "GET", url: `/api/auth/invites/${firstToken}` })).json())
      .toMatchObject({ available: false, experience: "onboarding_v1_pilot", replayAvailable: false });
    expect((await app.inject({ method: "GET", url: `/api/auth/invites/${token}` })).json())
      .toMatchObject({ available: true, experience: "onboarding_v1_pilot", replayAvailable: false });

    const joined = await app.inject({
      method: "POST", url: "/api/auth/join", headers: { "x-rehearsal-client": "web" },
      payload: { token, name: "Pilot", pin: "246810", language: "en" },
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().onboarding).toMatchObject({
      version: 1, eligibility: "pilot", status: "pending", language: "en", starterReady: true,
      starterTutorThreadId: "10000000-0000-4000-8000-000000000001",
    });
    const profile = joined.json().profile as { id: string };
    expect((await app.inject({
      method: "POST", url: "/api/auth/pilot-replay", headers: { "x-rehearsal-client": "web" },
      payload: { token, pin: "0000" },
    })).statusCode).toBe(401);
    const replayLogin = await app.inject({
      method: "POST", url: "/api/auth/pilot-replay", headers: { "x-rehearsal-client": "web" },
      payload: { token, pin: "246810" },
    });
    expect(replayLogin.statusCode).toBe(200);
    expect(replayLogin.json()).toMatchObject({
      profile: { id: profile.id }, onboarding: { eligibility: "pilot", status: "pending" },
    });
    for (let visit = 0; visit < 8; visit += 1) {
      const replayLink = await app.inject({ method: "GET", url: `/api/auth/invites/${token}` });
      expect(replayLink.statusCode).toBe(200);
      expect(replayLink.json()).toMatchObject({
        available: false, experience: "onboarding_v1_pilot", replayAvailable: true,
      });
    }
    const repository = manager.get(profile.id).repository;
    expect(repository.items.list("en", 20)).toHaveLength(6);
    expect(repository.library.listIslands("en").map((topic) => [topic.title, topic.itemCount])).toEqual([
      ["Доставка посылки", 3], ["Заказываем кофе", 3],
    ]);
    expect(repository.tutor.listThreads("en")).toHaveLength(1);
    expect(repository.capture.list("en", true)).toHaveLength(2);
    expect(repository.capture.list("en", true).every((note) => note.status === "processed")).toBe(true);

    const pilotSession = { cookie: cookieHeader(joined), csrfToken: joined.json().csrfToken };
    expect((await read(app, pilotSession, "/api/onboarding")).json().onboarding.status).toBe("pending");
    const completed = await mutate(app, pilotSession, { method: "POST", url: "/api/onboarding/complete" });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().onboarding).toMatchObject({ status: "completed", completedAt: expect.any(String) });
    expect((await mutate(app, pilotSession, { method: "POST", url: "/api/onboarding/complete" }))
      .json().onboarding).toEqual(completed.json().onboarding);

    const secondPilot = await mutate(app, roman, {
      method: "POST", url: "/api/auth/invites", payload: { purpose: "onboarding_v1_pilot" },
    });
    expect(secondPilot.statusCode).toBe(409);

    await app.close();
    manager.close();
    manager = await ProfileManager.create({ dataDir, backupDir, legacyDatabasePath: legacyPath, pins });
    app = await buildApp(manager, { sessionSecret, cookieSecure: true });
    const afterRestart = await login(app, profile.id, "246810");
    expect(afterRestart.response.json().onboarding.status).toBe("completed");
    expect(manager.get(profile.id).repository.items.list("en", 20)).toHaveLength(6);
  });

  it("keeps an invitation available when a case-insensitive profile name is rejected", async () => {
    const roman = (await login(app, "roman")).session!;
    const invitation = await mutate(app, roman, { method: "POST", url: "/api/auth/invites" });
    const token = invitation.json().token as string;
    const duplicate = await app.inject({
      method: "POST", url: "/api/auth/join", headers: { "x-rehearsal-client": "web" },
      payload: { token, name: " roman ", pin: "1234", language: "en" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/api/auth/invites/${token}` })).json().available).toBe(true);
  });

  it("enables Vietnamese only for Oliver and preserves its data when disabled", async () => {
    manager.get("oliver").repository.system.setLanguageEnabled("vi", true);
    const romanLogin = await login(app, "roman");
    const oliverLogin = await login(app, "oliver");
    const roman = romanLogin.session!;
    const oliver = oliverLogin.session!;

    expect(romanLogin.response.json().availableLanguages.map((language: { code: string }) => language.code))
      .toEqual(["en", "lv", "no"]);
    expect(oliverLogin.response.json().availableLanguages.map((language: { code: string }) => language.code))
      .toEqual(["en", "lv", "vi", "no"]);
    expect((await read(app, roman, "/api/config")).json().languages.map((language: { code: string }) => language.code))
      .toEqual(["en", "lv", "no"]);
    expect((await read(app, oliver, "/api/config")).json().languages.map((language: { code: string }) => language.code))
      .toEqual(["en", "lv", "vi", "no"]);

    for (const url of [
      "/api/items?language=vi", "/api/practice/due?language=vi",
      "/api/practice/progress?language=vi&since=2000-01-01T00:00:00.000Z",
      "/api/islands?language=vi", "/api/chat/threads?language=vi", "/api/captures?language=vi",
    ]) {
      const response = await read(app, roman, url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json()).toEqual({ error: "LANGUAGE_NOT_ENABLED" });
    }

    const createdIsland = await mutate(app, oliver, {
      method: "POST", url: "/api/islands",
      payload: { language: "vi", title: "Quán cà phê", itemIds: [] },
    });
    const islandId = createdIsland.json().island.publicId as string;
    const createdItem = await mutate(app, oliver, {
      method: "POST", url: "/api/items",
      payload: { language: "vi", cue: "Я хочу кофе.", target: "Tôi muốn uống cà phê.", topicId: islandId },
    });
    const itemId = createdItem.json().item.publicId as string;
    const createdThread = await mutate(app, oliver, {
      method: "POST", url: "/api/chat",
      payload: { language: "vi", message: "Giúp tôi luyện câu này.", clientMessageId: "ef55fa77-a526-4056-a8f2-d71cce76e02f" },
    });
    const threadId = createdThread.json().threadId as string;
    const createdCapture = await mutate(app, oliver, {
      method: "POST", url: "/api/captures/text",
      payload: { language: "vi", transcript: "Хочу заказать кофе по-вьетнамски." },
    });
    const captureId = createdCapture.json().note.publicId as string;
    const batch = manager.get("oliver").repository.reviews.create({
      language: "vi", kind: "vocab", title: "Vietnamese review", candidates: [],
    });
    const beforeDisable = manager.get("oliver").repository.system.stats();

    manager.get("oliver").repository.system.setLanguageEnabled("vi", false);
    const blockedResources = [
      { method: "PATCH", url: `/api/items/${itemId}`, payload: { target: "Xin chào" } },
      { method: "POST", url: "/api/attempts/evaluate", payload: { itemId, answer: "Xin chào", mode: "recall" } },
      { method: "POST", url: "/api/reviews", payload: { itemId, mode: "shadow", rating: "good" } },
      { method: "GET", url: `/api/islands/${islandId}` },
      { method: "GET", url: `/api/chat/${threadId}/messages` },
      { method: "GET", url: `/api/review-batches/${batch.publicId}` },
      { method: "PATCH", url: `/api/captures/${captureId}`, payload: { transcript: "Сохранить" } },
    ] as const;
    for (const request of blockedResources) {
      const response = request.method === "GET"
        ? await read(app, oliver, request.url)
        : await mutate(app, oliver, request);
      expect(response.statusCode, request.url).toBe(403);
      expect(response.json()).toEqual({ error: "LANGUAGE_NOT_ENABLED" });
    }
    expect(manager.get("oliver").repository.system.stats()).toEqual(beforeDisable);
    expect(manager.get("oliver").repository.items.get(itemId)?.target).toBe("Tôi muốn uống cà phê.");
    expect(manager.get("roman").repository.items.get(itemId)).toBeNull();
  });

  it("refuses to recreate a missing registry beside existing profile data", async () => {
    await app.close();
    manager.close();
    fs.rmSync(path.join(dataDir, "profiles", "registry.json"));

    await expect(ProfileManager.create({
      dataDir,
      backupDir,
      legacyDatabasePath: legacyPath,
      pins,
    })).rejects.toThrow("Profile registry is missing while profile databases exist");
  });
});
