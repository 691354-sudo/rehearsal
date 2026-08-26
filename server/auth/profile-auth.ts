import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  isLanguageCode,
  languageCatalog,
  type InvitationPurpose,
  type LanguageCode,
} from "../../contracts/api.js";
import type { HttpDependencies } from "../http/dependencies.js";
import type { ProfileId } from "../profiles/manager.js";
import { TelegramInitDataError, validateTelegramInitData } from "../telegram/init-data.js";
import type { TelegramUserProfileAccess } from "../telegram/access.js";
import { LoginRateLimiter } from "./rate-limit.js";

export const sessionCookieName = "rehearsal_session";
export const csrfCookieName = "rehearsal_csrf";
const sessionSeconds = 30 * 24 * 60 * 60;
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const publicAuthPath = (request: FastifyRequest) => {
  const pathname = request.url.split("?", 1)[0];
  return pathname === "/api/auth/profiles" || pathname === "/api/auth/login"
    || pathname === "/api/auth/join" || pathname === "/api/auth/pilot-replay"
    || pathname === "/api/auth/telegram/session" || pathname === "/api/auth/telegram/bind"
    || (request.method === "GET" && pathname.startsWith("/api/auth/invites/"));
};

type AuthOptions = {
  cookieSecure: boolean;
  telegramBotToken: string;
  telegramAllowedProfileIds: readonly string[];
  telegramAllowedUserIds: readonly string[];
  telegramUserProfileAccess: TelegramUserProfileAccess;
};

const sessionValue = (profileId: ProfileId) => Buffer.from(JSON.stringify({
  profileId,
  expiresAt: Date.now() + sessionSeconds * 1_000,
  nonce: randomUUID(),
})).toString("base64url");

const sessionProfile = (request: FastifyRequest, dependencies: HttpDependencies) => {
  const raw = request.cookies[sessionCookieName];
  if (!raw || !dependencies.profiles) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid) return null;
  try {
    const payload = JSON.parse(Buffer.from(unsigned.value, "base64url").toString("utf8")) as {
      profileId?: string;
      expiresAt?: number;
    };
    if (!payload.profileId || !dependencies.profiles.hasProfile(payload.profileId)) return null;
    if (!payload.expiresAt || payload.expiresAt <= Date.now()) return null;
    return payload.profileId;
  } catch {
    return null;
  }
};

export const registerProfileAuth = (
  app: FastifyInstance,
  dependencies: HttpDependencies,
  options: AuthOptions,
) => {
  const profiles = dependencies.profiles;
  if (!profiles) return;
  const limiter = new LoginRateLimiter();
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: options.cookieSecure,
    sameSite: "strict" as const,
    signed: true,
    maxAge: sessionSeconds,
  };
  const authSession = (profileId: ProfileId, csrfToken: string) => ({
    profile: profiles.listProfiles().find((profile) => profile.id === profileId),
    csrfToken,
    availableLanguages: profiles.get(profileId).repository.system.listLanguages(),
    onboarding: profiles.onboardingState(profileId),
  });

  app.addHook("onRequest", (request, reply, done) => {
    if (!request.url.startsWith("/api/") || !stateChangingMethods.has(request.method)) return done();
    if (request.headers["x-rehearsal-client"] !== "web") {
      void reply.code(403).send({ error: "CLIENT_HEADER_REQUIRED" });
      return;
    }
    if ([
      "/api/auth/login", "/api/auth/join", "/api/auth/pilot-replay",
      "/api/auth/telegram/session", "/api/auth/telegram/bind",
    ].includes(request.url)) return done();
    app.csrfProtection(request, reply, done);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/") || publicAuthPath(request)) {
      return;
    }
    const profileId = sessionProfile(request, dependencies);
    if (!profileId) return reply.code(401).send({ error: "PROFILE_SESSION_REQUIRED" });
    dependencies.bindProfile(request, profileId);
  });

  app.get("/api/auth/profiles", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { profiles: profiles.listProfiles() };
  });

  app.post("/api/auth/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({
      profileId: z.string().min(1).max(64),
      pin: z.string().regex(/^\d{4,12}$/),
    }).parse(request.body);
    const key = `${request.ip}:${body.profileId}`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      return reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "LOGIN_RATE_LIMITED" });
    }
    if (!profiles.verifyPin(body.profileId, body.pin)) {
      limiter.fail(key);
      return reply.code(401).send({ error: "INVALID_PROFILE_PIN" });
    }
    limiter.clear(key);
    reply.setCookie(sessionCookieName, sessionValue(body.profileId), cookieOptions);
    const csrfToken = reply.generateCsrf();
    return authSession(body.profileId, csrfToken);
  });

  const telegramIdentity = (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.telegramBotToken) {
      void reply.code(503).send({ error: "TELEGRAM_AUTH_UNAVAILABLE" });
      return null;
    }
    const body = z.object({ initData: z.string().min(1).max(16_000) }).parse(request.body);
    const key = `${request.ip}:telegram`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      void reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "LOGIN_RATE_LIMITED" });
      return null;
    }
    try {
      const identity = validateTelegramInitData(body.initData, options.telegramBotToken);
      limiter.clear(key);
      return identity;
    } catch (error) {
      limiter.fail(key);
      const code = error instanceof TelegramInitDataError ? error.code : "INVALID_TELEGRAM_INIT_DATA";
      void reply.code(401).send({ error: code });
      return null;
    }
  };

  const telegramProfilesForUser = (userId: string) =>
    (options.telegramUserProfileAccess[userId] || [])
      .filter((profileId) => options.telegramAllowedProfileIds.includes(profileId));
  const telegramProfileAllowed = (userId: string, profileId: ProfileId) =>
    telegramProfilesForUser(userId).includes(profileId);
  const telegramUserAllowed = (userId: string) =>
    options.telegramAllowedUserIds.includes(userId) && telegramProfilesForUser(userId).length > 0;

  app.post("/api/auth/telegram/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const identity = telegramIdentity(request, reply);
    if (!identity) return;
    if (!telegramUserAllowed(identity.userId)) {
      return reply.code(403).send({ error: "TELEGRAM_USER_NOT_ALLOWED" });
    }
    const found = profiles.telegram.get(identity.userId);
    if (!found || !telegramProfileAllowed(identity.userId, found.profileId)) {
      const allowedProfiles = telegramProfilesForUser(identity.userId);
      return reply.code(401).send({
        error: "TELEGRAM_BINDING_REQUIRED",
        profiles: profiles.listProfiles().filter((profile) => allowedProfiles.includes(profile.id)),
      });
    }
    profiles.telegram.update(identity.userId, { chatId: identity.chatId });
    reply.setCookie(sessionCookieName, sessionValue(found.profileId), cookieOptions);
    return authSession(found.profileId, reply.generateCsrf());
  });

  app.post("/api/auth/telegram/bind", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({
      initData: z.string().min(1).max(16_000),
      profileId: z.string().min(1).max(64),
      pin: z.string().regex(/^\d{4,12}$/),
    }).parse(request.body);
    if (!options.telegramBotToken) return reply.code(503).send({ error: "TELEGRAM_AUTH_UNAVAILABLE" });
    const key = `${request.ip}:telegram-bind:${body.profileId}`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      return reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "LOGIN_RATE_LIMITED" });
    }
    let identity;
    try {
      identity = validateTelegramInitData(body.initData, options.telegramBotToken);
    } catch (error) {
      limiter.fail(key);
      const code = error instanceof TelegramInitDataError ? error.code : "INVALID_TELEGRAM_INIT_DATA";
      return reply.code(401).send({ error: code });
    }
    if (!telegramUserAllowed(identity.userId)) {
      return reply.code(403).send({ error: "TELEGRAM_USER_NOT_ALLOWED" });
    }
    if (!profiles.hasProfile(body.profileId) || !telegramProfileAllowed(identity.userId, body.profileId)) {
      return reply.code(403).send({ error: "TELEGRAM_PROFILE_NOT_ALLOWED" });
    }
    if (!profiles.verifyPin(body.profileId, body.pin)) {
      limiter.fail(key);
      return reply.code(401).send({ error: "INVALID_PROFILE_PIN" });
    }
    const enabledLanguages = profiles.get(body.profileId).repository.system.listLanguages();
    try {
      profiles.telegram.bind({
        profileId: body.profileId,
        userId: identity.userId,
        chatId: identity.chatId,
        language: enabledLanguages[0]?.code || "en",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "TELEGRAM_ID_ALREADY_BOUND") {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
    limiter.clear(key);
    reply.setCookie(sessionCookieName, sessionValue(body.profileId), cookieOptions);
    return authSession(body.profileId, reply.generateCsrf());
  });

  app.post("/api/auth/pilot-replay", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({
      token: z.string().min(1).max(16),
      pin: z.string().regex(/^\d{4,12}$/),
    }).parse(request.body);
    const key = `${request.ip}:pilot-replay:${body.token.replaceAll("-", "").toUpperCase()}`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      return reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "LOGIN_RATE_LIMITED" });
    }
    const [, replayAvailable, profileId] = profiles.inviteExperience(body.token);
    if (!replayAvailable || !profileId || !profiles.verifyPin(profileId, body.pin)) {
      limiter.fail(key);
      return reply.code(401).send({ error: "INVALID_PILOT_REPLAY" });
    }
    limiter.clear(key);
    reply.setCookie(sessionCookieName, sessionValue(profileId), cookieOptions);
    return authSession(profileId, reply.generateCsrf());
  });

  app.post("/api/auth/invites", async (request, reply) => {
    const context = dependencies.forRequest(request);
    const body = z.object({
      purpose: z.enum(["standard", "onboarding_v1_pilot"]).optional(),
    }).parse(request.body || {}) as { purpose?: InvitationPurpose };
    try {
      return { token: profiles.createInvite(context.profileId!, body.purpose || "standard") };
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVITATION_FAILED";
      if (code === "PILOT_INVITE_FORBIDDEN") return reply.code(403).send({ error: code });
      if (code === "PILOT_PROFILE_EXISTS") return reply.code(409).send({ error: code });
      throw error;
    }
  });

  app.get("/api/auth/invites/:token", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { token } = z.object({ token: z.string().min(1).max(16) }).parse(request.params);
    const key = `${request.ip}:invite-check`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      return reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "INVITE_RATE_LIMITED" });
    }
    const available = profiles.inviteAvailable(token);
    const [experience, replayAvailable] = profiles.inviteExperience(token);
    if (!experience) limiter.fail(key);
    return {
      available,
      experience: experience || "standard",
      languages: Object.values(languageCatalog),
      replayAvailable,
    };
  });

  app.post("/api/auth/join", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = z.object({
      token: z.string().min(1).max(16),
      name: z.string().trim().min(1).max(40),
      pin: z.string().regex(/^\d{4,10}$/),
      language: z.custom<LanguageCode>(isLanguageCode),
    }).parse(request.body);
    const key = `${request.ip}:join:${body.token.replaceAll("-", "").toUpperCase()}`;
    const rate = limiter.blocked(key);
    if (rate.blocked) {
      return reply.header("Retry-After", rate.retryAfterSeconds).code(429).send({ error: "JOIN_RATE_LIMITED" });
    }
    try {
      const profile = profiles.createInvitedProfile(body);
      limiter.clear(key);
      reply.setCookie(sessionCookieName, sessionValue(profile.id), cookieOptions);
      return authSession(profile.id, reply.generateCsrf());
    } catch (error) {
      limiter.fail(key);
      const code = error instanceof Error ? error.message : "JOIN_FAILED";
      if (code === "INVITATION_UNAVAILABLE") return reply.code(410).send({ error: code });
      if (code === "PILOT_PROFILE_EXISTS") return reply.code(409).send({ error: code });
      if (code === "PROFILE_NAME_TAKEN") return reply.code(409).send({ error: code });
      if (["INVALID_PROFILE_NAME", "INVALID_NEW_PROFILE_PIN", "INVALID_PROFILE_LANGUAGE"].includes(code)) {
        return reply.code(400).send({ error: code });
      }
      throw error;
    }
  });

  app.get("/api/auth/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const context = dependencies.forRequest(request);
    const profile = profiles.listProfiles().find((candidate) => candidate.id === context.profileId);
    return authSession(profile!.id, reply.generateCsrf());
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.clearCookie(sessionCookieName, { path: "/", secure: options.cookieSecure, sameSite: "strict" });
    reply.clearCookie(csrfCookieName, { path: "/", secure: options.cookieSecure, sameSite: "strict" });
    return reply.code(204).send();
  });
};
