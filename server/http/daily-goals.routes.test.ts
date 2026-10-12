import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { defaultDailyGoals } from "../../contracts/daily-goals.js";
import { buildApp } from "../app.js";
import { ProfileManager } from "../profiles/manager.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext } from "../testing/api-test-context.js";

it("shares goals and confirmed events across two devices, isolates profiles and requires CSRF", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "echo-daily-goals-"));
  const manager = await ProfileManager.create({ dataDir: path.join(temp, "data"), backupDir: path.join(temp, "backup"),
    legacyDatabasePath: path.join(temp, "data", "rehearsal.sqlite"), pins: { roman: "1234", oliver: "5678", zanna: "2345" } });
  const app = await buildApp(manager, { sessionSecret: "test-session-secret-with-more-than-thirty-two-bytes", cookieSecure: true });
  const login = async (profileId: string, pin: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-rehearsal-client": "web" }, payload: { profileId, pin } });
    expect(response.statusCode).toBe(200);
    return { cookie: response.cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      "x-csrf-token": response.json().csrfToken, "x-rehearsal-client": "web", "x-rehearsal-profile": profileId };
  };
  try {
    const first = await login("roman", "1234"), second = await login("roman", "1234"), other = await login("oliver", "5678");
    const get = async (headers: typeof first) => (await app.inject({ method: "GET", url: "/api/goals", headers })).json();
    expect((await app.inject({ method: "GET", url: "/api/goals" })).statusCode).toBe(401);
    const start = { method: "POST" as const, url: "/api/goals/start", payload: {} };
    expect((await app.inject({ ...start, headers: { cookie: first.cookie, "x-rehearsal-client": "web" } })).statusCode).toBe(403);
    expect((await app.inject({ ...start, headers: first })).statusCode).toBe(200);
    expect((await app.inject({ ...start, headers: second })).json().startedAt).toBe((await get(first)).startedAt);
    expect((await get(other)).startedAt).toBeNull();
    const settings = { ...defaultDailyGoals, listen: { enabled: false, target: 150 }, recall: { enabled: true, target: 2 }, tutor: { enabled: false, target: 10 } };
    expect((await app.inject({ method: "PATCH", url: "/api/goals/settings", headers: first, payload: { settings } })).statusCode).toBe(200);
    expect((await get(second)).today.settings).toEqual(settings);
    expect((await get(other)).today.settings).toEqual(defaultDailyGoals);
    for (const target of [0, -1, 1.5, "", "20", null]) {
      expect((await app.inject({ method: "PATCH", url: "/api/goals/settings", headers: first,
        payload: { settings: { ...settings, recall: { enabled: true, target } } } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "PATCH", url: "/api/goals/settings", headers: first,
      payload: { settings: { ...settings, recall: { enabled: false, target: 2 } } } })).statusCode).toBe(400);
    expect((await get(second)).today.settings).toEqual(settings);
    expect((await app.inject({ method: "PATCH", url: "/api/goals/settings", headers: other, payload: { settings } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/goals", headers: { ...second, "x-rehearsal-profile": "oliver" } })).statusCode).toBe(409);
    const repo = manager.get("roman").repository;
    repo.goals.record("recall", "confirmed-one", "en"); repo.goals.record("recall", "confirmed-two", "lv");
    expect((await get(second)).today).toMatchObject({ counts: { recall: 2 }, anyReached: true, allReached: true });
    expect((await get(other)).today.counts.recall).toBe(0);
  } finally { await app.close(); manager.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});

it("credits only successful server checks, once per attempt, never oral self ratings or failures", async () => {
  const context = createApiTestContext();
  const repo = context.repository;
  repo.goals.start();
  const card = repo.items.list("en", 1)[0];
  repo.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId: card.publicId });
  const attempt = () => {
    const attemptId = randomUUID();
    repo.pilot.recall.begin({ attemptId, cardId: card.publicId, shownAt: new Date().toISOString(), timezone: "Europe/Riga" });
    return attemptId;
  };
  const openai = new OpenAIService(repo);
  const check = vi.spyOn(openai, "checkRecall").mockResolvedValue({ verdict: "correct", explanationRu: "Верно", correctedAnswer: card.target, mistakes: [] });
  const app = await buildApp(repo, { openai });
  try {
    const attemptId = attempt();
    const request = { method: "POST" as const, url: "/api/pilot/attempts/check", payload: { attemptId, answer: card.target } };
    await Promise.all([app.inject(request), app.inject(request)]);
    expect(repo.goals.snapshot().today.counts.recall).toBe(1);
    check.mockResolvedValueOnce({ verdict: "correct", explanationRu: "Другой правильный вариант", correctedAnswer: "A valid alternative.", mistakes: [] });
    expect((await app.inject({ ...request, payload: { attemptId: attempt(), answer: "A valid alternative." } })).statusCode).toBe(200);
    check.mockResolvedValueOnce({ verdict: "incorrect", explanationRu: "Ошибка", correctedAnswer: card.target, mistakes: [] });
    expect((await app.inject({ ...request, payload: { attemptId: attempt(), answer: "wrong" } })).statusCode).toBe(200);
    check.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await app.inject({ ...request, payload: { attemptId: attempt(), answer: "failed" } })).statusCode).toBe(503);
    const now = new Date().toISOString();
    expect((await app.inject({ method: "POST", url: "/api/pilot/attempts/grade", payload: { attemptId: attempt(),
      rating: "easy", revealedAt: now, ratedAt: now, responseTimeMs: 0, inputMode: "oral_self_check", answer: "" } })).statusCode).toBe(200);
    expect(repo.goals.snapshot().today.counts.recall).toBe(2);
  } finally { await app.close(); vi.restoreAllMocks(); context.close(); }
});
