import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { HttpDependencies } from "./dependencies.js";
import { languageSchema } from "./schemas.js";
import { onboardingAnswersSchema, tutorModeSchema, tutorOverridesSchema, tutorSettingsSchema } from "../../contracts/tutor-adaptation.js";
import { effectiveTutorSettings, TUTOR_CONFIG_VERSION } from "../services/tutor-mode-config.js";
import { PilotError } from "../db/pilot/store.js";

const pair = z.object({ language: languageSchema, nativeLanguage: z.literal("ru").default("ru") });
const texts = z.array(z.string().trim().min(1).max(500)).max(8);
export const registerTutorAdaptationRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/tutor/learning-profile", async (request) => {
    const { language, nativeLanguage } = pair.parse(request.query);
    const { repository, profileId } = dependencies.forRequest(request);
    const enabled = repository.tutor.adaptation.enabled();
    const profile = enabled ? repository.tutor.adaptation.start(language, nativeLanguage) : repository.tutor.adaptation.get(language, nativeLanguage);
    return { enabled, profile, userId: profileId, settings: effectiveTutorSettings(profile), configVersion: TUTOR_CONFIG_VERSION };
  });
  app.post("/api/tutor/onboarding/answer", async (request) => {
    const body = pair.extend({ expectedStep: z.number().int().min(0).max(6), step: z.number().int().min(0).max(6), answers: onboardingAnswersSchema }).strict().parse(request.body);
    const adaptation = dependencies.forRequest(request).repository.tutor.adaptation;
    if (!adaptation.enabled()) throw new PilotError("TUTOR_ADAPTATION_DISABLED");
    return { profile: adaptation.answer(body.language, body.nativeLanguage, body.expectedStep, body.step, body.answers) };
  });
  for (const action of ["skip", "complete"] as const) app.post(`/api/tutor/onboarding/${action}`, async (request) => {
    const { language, nativeLanguage } = pair.strict().parse(request.body);
    const adaptation = dependencies.forRequest(request).repository.tutor.adaptation;
    if (!adaptation.enabled()) throw new PilotError("TUTOR_ADAPTATION_DISABLED");
    return { profile: adaptation.complete(language, nativeLanguage, action === "skip") };
  });
  app.patch("/api/tutor/learning-profile", async (request) => {
    const body = pair.extend({ threadId: z.string().uuid().optional(), mode: tutorModeSchema.optional(), overrides: tutorOverridesSchema.optional(),
      removeOverrides: z.array(tutorSettingsSchema.keyof()).max(7).optional(), resetOverrides: z.boolean().optional(), goals: texts.optional(), interests: texts.optional() }).strict().parse(request.body);
    const repository = dependencies.forRequest(request).repository;
    if (!repository.tutor.adaptation.enabled()) throw new PilotError("TUTOR_ADAPTATION_DISABLED");
    if (body.threadId && repository.tutor.getThread(body.threadId)?.language_code !== body.language) throw new Error("THREAD_LANGUAGE_MISMATCH");
    const profile = repository.tutor.adaptation.update(body.language, body.nativeLanguage, body);
    if (body.mode && body.threadId) repository.tutor.adaptation.setSessionMode(body.threadId, body.mode);
    return { profile, settings: effectiveTutorSettings(profile), configVersion: TUTOR_CONFIG_VERSION };
  });
  app.post("/api/chat/:threadId/finish", async (request, reply) => {
    const { threadId } = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const { repository, adaptation } = dependencies.forRequest(request);
    if (!repository.tutor.getThread(threadId)) return reply.code(404).send({ error: "THREAD_NOT_FOUND" });
    return adaptation.finish(threadId);
  });
};
