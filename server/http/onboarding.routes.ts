import type { FastifyInstance } from "fastify";
import type { HttpDependencies } from "./dependencies.js";

export const registerOnboardingRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  if (!dependencies.profiles) return;

  app.get("/api/onboarding", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { profileId } = dependencies.forRequest(request);
    return { onboarding: dependencies.profiles!.onboardingState(profileId!) };
  });

  app.post("/api/onboarding/complete", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { profileId } = dependencies.forRequest(request);
    try {
      return { onboarding: dependencies.profiles!.completeOnboarding(profileId!) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "ONBOARDING_FAILED";
      if (code === "ONBOARDING_NOT_AVAILABLE") return reply.code(404).send({ error: code });
      if (code === "PILOT_ONBOARDING_NOT_READY") return reply.code(409).send({ error: code });
      throw error;
    }
  });
};
