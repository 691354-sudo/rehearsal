import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  isLanguageCode,
  languageCatalog,
  type InvitationPurpose,
  type LanguageCode,
} from "../../contracts/api.js";
import type { HttpDependencies } from "../http/dependencies.js";
import type { ProfileId } from "../profiles/manager.js";
import { LoginRateLimiter } from "./rate-limit.js";

export const sessionCookieName = "rehearsal_session";
export const csrfCookieName = "rehearsal_csrf";
const sessionSeconds = 30 * 24 * 60 * 60;
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const publicAuthPath = (request: FastifyRequest) => {
  const pathname = request.url.split("?", 1)[0];
  return pathname === "/api/auth/profiles" || pathname === "/api/auth/login"
    || pathname === "/api/auth/join" || pathname === "/api/auth/pilot-replay"
    || (request.method === "GET" && pathname.startsWith("/api/auth/invites/"));
};

type AuthOptions = {
  cookieSecure: boolean;
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
    if (["/api/auth/login", "/api/auth/join", "/api/auth/pilot-replay"].includes(request.url)) return done();
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
