import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ProfileManager } from "../profiles/manager.js";

const token = "123456:test-token";
const pins = { roman: "1234", oliver: "5678", zanna: "2345" };
const sessionSecret = "telegram-auth-test-session-secret-longer-than-32-bytes";

const initData = (userId: number, authDate = Math.floor(Date.now() / 1_000)) => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  const check = [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
};

describe("Telegram profile auth", () => {
  let tempDir: string;
  let manager: ProfileManager;
  let app: FastifyInstance;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-telegram-auth-"));
    manager = await ProfileManager.create({
      dataDir: path.join(tempDir, "data"),
      backupDir: path.join(tempDir, "backups"),
      legacyDatabasePath: path.join(tempDir, "data", "rehearsal.sqlite"),
      pins,
    });
    app = await buildApp(manager, {
      sessionSecret,
      cookieSecure: true,
      telegramBotToken: token,
      telegramAllowedProfileIds: ["roman", "oliver"],
      telegramAllowedUserIds: ["101", "202", "303", "404", "505"],
    });
  });

  afterEach(async () => {
    await app.close();
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const bind = (userId: number, profileId: string, pin: string) => app.inject({
    method: "POST",
    url: "/api/auth/telegram/bind",
    headers: { "x-rehearsal-client": "web" },
    payload: { initData: initData(userId), profileId, pin },
  });

  it("binds two Telegram accounts to one profile and restores normal cookie sessions", async () => {
    const unbound = await app.inject({
      method: "POST", url: "/api/auth/telegram/session",
      headers: { "x-rehearsal-client": "web" }, payload: { initData: initData(101) },
    });
    expect(unbound.statusCode).toBe(401);
    expect(unbound.json()).toEqual({
      error: "TELEGRAM_BINDING_REQUIRED",
      profiles: [{ id: "roman", name: "Roman" }, { id: "oliver", name: "Oliver" }],
    });
    expect((await bind(101, "roman", "9999")).statusCode).toBe(401);
    const first = await bind(101, "roman", "1234");
    const second = await bind(202, "roman", "1234");
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ profile: { id: "roman" }, csrfToken: expect.any(String) });

    manager.telegram.update("101", { mode: "tutor", language: "en" });
    manager.telegram.update("202", { mode: "notebook", language: "lv" });
    expect(manager.telegram.get("101")?.binding).toMatchObject({ mode: "tutor", language: "en" });
    expect(manager.telegram.get("202")?.binding).toMatchObject({ mode: "notebook", language: "lv" });

    const restored = await app.inject({
      method: "POST", url: "/api/auth/telegram/session",
      headers: { "x-rehearsal-client": "web" }, payload: { initData: initData(101) },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().profile).toEqual({ id: "roman", name: "Roman" });
    expect(String(restored.headers["set-cookie"])).toContain("rehearsal_session=");
  });

  it("rejects one Telegram id in two profiles and rate-limits bad PIN attempts", async () => {
    expect((await bind(303, "roman", "1234")).statusCode).toBe(200);
    expect((await bind(303, "oliver", "5678")).statusCode).toBe(409);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await bind(404, "roman", "9999")).statusCode).toBe(401);
    }
    expect((await bind(404, "roman", "9999")).statusCode).toBe(429);
  });

  it("rejects tampered and expired initData without creating a binding", async () => {
    const valid = initData(505);
    const tampered = await app.inject({
      method: "POST", url: "/api/auth/telegram/bind",
      headers: { "x-rehearsal-client": "web" },
      payload: { initData: valid.replace("505", "506"), profileId: "roman", pin: "1234" },
    });
    expect(tampered.statusCode).toBe(401);
    const expired = await app.inject({
      method: "POST", url: "/api/auth/telegram/session",
      headers: { "x-rehearsal-client": "web" },
      payload: { initData: initData(505, Math.floor(Date.now() / 1_000) - 601) },
    });
    expect(expired.statusCode).toBe(401);
    expect(manager.telegram.get("505")).toBeNull();
  });

  it("rejects existing and new Telegram users outside the runtime allowlist", async () => {
    manager.telegram.bind({ profileId: "roman", userId: "606", chatId: "606", language: "en" });
    const session = await app.inject({
      method: "POST", url: "/api/auth/telegram/session",
      headers: { "x-rehearsal-client": "web" }, payload: { initData: initData(606) },
    });
    expect(session.statusCode).toBe(403);
    expect(session.json()).toEqual({ error: "TELEGRAM_USER_NOT_ALLOWED" });

    const binding = await bind(707, "roman", "1234");
    expect(binding.statusCode).toBe(403);
    expect(manager.telegram.get("707")).toBeNull();
  });
});
