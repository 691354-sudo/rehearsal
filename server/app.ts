import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import csrfProtection from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { csrfCookieName, registerProfileAuth } from "./auth/profile-auth.js";
import { config } from "./config.js";
import { RehearsalRepository } from "./db/repository.js";
import { registerAudioRoutes } from "./http/audio.routes.js";
import { registerCaptureRoutes } from "./http/capture.routes.js";
import { createHttpDependencies, type ServiceOverrides } from "./http/dependencies.js";
import { toErrorResponse } from "./http/errors.js";
import { registerItemRoutes } from "./http/items.routes.js";
import { registerLanguageAccess } from "./http/language-access.js";
import { registerOnboardingRoutes } from "./http/onboarding.routes.js";
import { registerPracticeRoutes } from "./http/practice.routes.js";
import { registerSystemRoutes } from "./http/system.routes.js";
import { registerTutorRoutes } from "./http/tutor.routes.js";
import { ProfileManager } from "./profiles/manager.js";
import type { LanguageCode } from "./types.js";

type AppOptions = ServiceOverrides & {
  sessionSecret?: string;
  cookieSecure?: boolean;
};

export const buildApp = async (
  runtime: RehearsalRepository | ProfileManager,
  options: AppOptions = {},
) => {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    bodyLimit: 2_000_000,
    trustProxy: config.trustedProxy,
  });
  const dependencies = createHttpDependencies(runtime, options);
  const sessionSecret = options.sessionSecret ?? config.sessionSecret;
  const cookieSecure = options.cookieSecure ?? config.sessionCookieSecure;

  await app.register(helmet, {
    hsts: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 0 },
  });
  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/],
    credentials: Boolean(dependencies.profiles),
  });

  if (dependencies.profiles) {
    if (Buffer.byteLength(sessionSecret) < 32) {
      throw new Error("SESSION_SECRET must contain at least 32 bytes");
    }
    await app.register(cookie, { secret: sessionSecret, algorithm: "sha256" });
    await app.register(csrfProtection, {
      cookieKey: csrfCookieName,
      cookieOpts: {
        path: "/",
        httpOnly: true,
        secure: cookieSecure,
        sameSite: "strict",
        signed: true,
        maxAge: 30 * 24 * 60 * 60,
      },
      getToken: (request) => request.headers["x-csrf-token"] as string | undefined,
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const response = toErrorResponse(error);
    void reply.code(response.statusCode).send(response.body);
  });

  registerProfileAuth(app, dependencies, { cookieSecure });
  registerLanguageAccess(app, dependencies);
  registerSystemRoutes(app, dependencies);
  registerOnboardingRoutes(app, dependencies);
  registerItemRoutes(app, dependencies);
  registerPracticeRoutes(app, dependencies);
  registerTutorRoutes(app, dependencies);
  registerAudioRoutes(app, dependencies);
  registerCaptureRoutes(app, dependencies);
  return app;
};

export type AppLanguage = LanguageCode;
