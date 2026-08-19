import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import type { RehearsalRepository } from "./db/repository.js";
import { registerAudioRoutes } from "./http/audio.routes.js";
import { registerCaptureRoutes } from "./http/capture.routes.js";
import type { HttpDependencies } from "./http/dependencies.js";
import { toErrorResponse } from "./http/errors.js";
import { registerItemRoutes } from "./http/items.routes.js";
import { registerPracticeRoutes } from "./http/practice.routes.js";
import { registerSystemRoutes } from "./http/system.routes.js";
import { registerTutorRoutes } from "./http/tutor.routes.js";
import { ElevenLabsService } from "./services/elevenlabs.js";
import { OpenAIService } from "./services/openai.js";
import { TutorService } from "./services/tutor.js";
import type { LanguageCode } from "./types.js";

export const buildApp = async (
  repository: RehearsalRepository,
  overrides: { openai?: OpenAIService; elevenlabs?: ElevenLabsService } = {},
) => {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  repository.library.runTopicBackfillMigration();
  const openai = overrides.openai || new OpenAIService(repository);
  const elevenlabs = overrides.elevenlabs || new ElevenLabsService(repository);
  const dependencies: HttpDependencies = {
    repository,
    openai,
    elevenlabs,
    tutor: new TutorService(repository, openai),
  };

  await app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 0 },
  });
  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/],
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const response = toErrorResponse(error);
    void reply.code(response.statusCode).send(response.body);
  });

  registerSystemRoutes(app, dependencies);
  registerItemRoutes(app, dependencies);
  registerPracticeRoutes(app, dependencies);
  registerTutorRoutes(app, dependencies);
  registerAudioRoutes(app, dependencies);
  registerCaptureRoutes(app, dependencies);
  return app;
};

export type AppLanguage = LanguageCode;
