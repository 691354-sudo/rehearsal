import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { languageSchema } from "./schemas.js";
import { nfcText } from "./schemas.js";

const scoreByRating = { again: 0, hard: 0.7, good: 0.85, easy: 1 } as const;

export const registerPracticeRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/practice/due", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({
      language: languageSchema.default("en"),
      limit: z.coerce.number().int().min(1).max(2_000).default(2_000),
      newLimit: z.coerce.number().int().min(0).max(30).optional(),
    }).parse(request.query);
    const newLimit = query.newLimit ?? repository.practice.getSettings().newItemsPerDay;
    const items = repository.practice.listDue(query.language, query.limit, new Date(), newLimit);
    const fresh = items.filter((item) => item.progress.stage === "new").length;
    return { items, composition: { due: items.length - fresh, new: fresh } };
  });

  app.get("/api/practice/progress", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({
      language: languageSchema.default("en"),
      since: z.string().datetime(),
    }).parse(request.query);
    const activity = repository.practice.countActivitySince(query.language, query.since);
    return { completed: activity.recall, ...activity };
  });

  app.post("/api/attempts/evaluate", async (request, reply) => {
    const { repository, openai } = dependencies.forRequest(request);
    const body = z.object({
      itemId: z.string().min(1),
      answer: nfcText(4_000),
      mode: z.enum(["recall", "shadow", "listen"]).default("recall"),
      rating: z.enum(["again", "hard", "good", "easy"]).optional(),
    }).parse(request.body);
    const item = repository.items.get(body.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    const result = openai.evaluate(item, body.answer);
    const rating = body.rating || ({ exact: "good", close: "hard", retry: "again" } as const)[result.evaluation.verdict];
    const attempt = repository.practice.recordAttempt({
      itemPublicId: item.publicId,
      mode: body.mode,
      answer: body.answer,
      score: scoreByRating[rating],
      verdict: rating,
      feedback: { ...result.evaluation, rating },
      rating,
    });
    return { ...result, attempt };
  });

  app.post("/api/reviews", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({
      itemId: z.string().min(1),
      mode: z.enum(["listen", "shadow"]),
      rating: z.enum(["again", "hard", "good", "easy"]),
    }).parse(request.body);
    const item = repository.items.get(body.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    const review = repository.practice.recordAttempt({
      itemPublicId: item.publicId,
      mode: body.mode,
      answer: "",
      score: scoreByRating[body.rating],
      verdict: body.rating,
      feedback: { rating: body.rating },
    });
    return { rating: body.rating, review };
  });
};
