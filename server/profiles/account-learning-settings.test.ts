import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ProfileManager } from "./manager.js";

it("shares audio and Tutor settings across signed-in devices while isolating other accounts and rejecting missing CSRF", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "echo-account-settings-"));
  const manager = await ProfileManager.create({ dataDir: path.join(temp, "data"), backupDir: path.join(temp, "backup"),
    legacyDatabasePath: path.join(temp, "data", "rehearsal.sqlite"), pins: { roman: "1234", oliver: "5678", zanna: "2345" } });
  const app = await buildApp(manager, { sessionSecret: "test-session-secret-with-more-than-thirty-two-bytes", cookieSecure: true });
  const login = async (profileId: string, pin: string) => {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-rehearsal-client": "web" }, payload: { profileId, pin } });
    expect(response.statusCode).toBe(200);
    return { cookie: response.cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      "x-csrf-token": response.json().csrfToken, "x-rehearsal-client": "web" };
  };
  try {
    const first = await login("roman", "1234"); const second = await login("roman", "1234"); const other = await login("oliver", "5678");
    const audio = { method: "PATCH" as const, url: "/api/settings/playback", payload: { language: "en", playback: { speed: 0.85, repetitions: 3 } } };
    expect((await app.inject({ ...audio, headers: { cookie: first.cookie, "x-rehearsal-client": "web" } })).statusCode).toBe(403);
    expect((await app.inject({ ...audio, headers: first })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=en", headers: second })).json().playback).toMatchObject({ speed: 0.85, repetitions: 3 });
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=en&profileId=roman", headers: other })).json().playback).toBeNull();
    await app.inject({ method: "POST", url: "/api/tutor/onboarding/skip", headers: first, payload: { language: "en" } });
    await app.inject({ method: "PATCH", url: "/api/tutor/learning-profile", headers: first, payload: { language: "en", mode: "advanced", overrides: { nativeLanguageUsage: "allowed" } } });
    expect((await app.inject({ method: "GET", url: "/api/tutor/learning-profile?language=en", headers: second })).json().profile).toMatchObject({ interactionMode: "advanced", customTutorSettings: { nativeLanguageUsage: "allowed" }, onboardingStatus: "skipped" });
    expect((await app.inject({ method: "GET", url: "/api/tutor/learning-profile?language=en&profileId=roman", headers: other })).json().profile).toMatchObject({ interactionMode: "intermediate", customTutorSettings: {}, onboardingStatus: "in_progress" });
  } finally { await app.close(); manager.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
