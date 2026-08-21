import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "../http/dependencies.js";
import { profileIds, type ProfileId } from "../profiles/manager.js";
import { LoginRateLimiter } from "./rate-limit.js";

export const sessionCookieName = "rehearsal_session";
export const csrfCookieName = "rehearsal_csrf";
const sessionSeconds = 30 * 24 * 60 * 60;
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

  app.addHook("onRequest", (request, reply, done) => {
    if (!request.url.startsWith("/api/") || !stateChangingMethods.has(request.method)) return done();
    if (request.headers["x-rehearsal-client"] !== "web") {
      void reply.code(403).send({ error: "CLIENT_HEADER_REQUIRED" });
      return;
    }
    if (request.url === "/api/auth/login") return done();
    app.csrfProtection(request, reply, done);
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/") || request.url === "/api/auth/profiles" || request.url === "/api/auth/login") {
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
      profileId: z.enum(profileIds),
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
    return {
      profile: profiles.listProfiles().find((profile) => profile.id === body.profileId),
      csrfToken,
      availableLanguages: profiles.get(body.profileId).repository.system.listLanguages(),
    };
  });

  app.get("/api/auth/session", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const context = dependencies.forRequest(request);
    const profile = profiles.listProfiles().find((candidate) => candidate.id === context.profileId);
    return {
      profile,
      csrfToken: reply.generateCsrf(),
      availableLanguages: context.repository.system.listLanguages(),
    };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.clearCookie(sessionCookieName, { path: "/", secure: options.cookieSecure, sameSite: "strict" });
    reply.clearCookie(csrfCookieName, { path: "/", secure: options.cookieSecure, sameSite: "strict" });
    return reply.code(204).send();
  });
};
