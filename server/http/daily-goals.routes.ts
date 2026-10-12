import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dailyGoalsSettingsSchema, defaultDailyGoals } from "../../contracts/daily-goals.js";
import type { HttpDependencies } from "./dependencies.js";

export const registerDailyGoalsRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/goals")) return;
    const { profileId } = dependencies.forRequest(request);
    const expected = request.headers["x-rehearsal-profile"];
    if (profileId && expected && profileId !== expected) return reply.code(409).send({ error: "PROFILE_CHANGED" });
  });
  app.get("/api/goals", async (request) => dependencies.forRequest(request).repository.goals.snapshot());
  app.post("/api/goals/start", async (request) => {
    const { settings } = z.object({ settings: dailyGoalsSettingsSchema.optional() }).parse(request.body ?? {});
    return dependencies.forRequest(request).repository.goals.start(settings ?? defaultDailyGoals);
  });
  app.patch("/api/goals/settings", async (request) => {
    const { settings } = z.object({ settings: dailyGoalsSettingsSchema }).parse(request.body);
    return dependencies.forRequest(request).repository.goals.update(settings);
  });
};
