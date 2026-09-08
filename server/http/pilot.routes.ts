import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { PilotError } from "../db/pilot/store.js";

const id = z.string().uuid();
const timestamp = z.string().datetime();
const language = z.literal("en").default("en");
const timezone = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Invalid timezone");
const feedbackSchema = z.object({
  difficulty: z.enum(["too_easy", "about_right", "too_hard"]),
  timeFit: z.enum(["shorter", "as_expected", "longer"]),
  nextStepClarity: z.enum(["yes", "not_always", "no"]),
  tutorHelpfulness: z.enum(["yes", "partly", "no", "didnt_reach_tutor"]).optional(),
  obstacleText: z.string().trim().max(1000).optional(),
  requestedPracticeText: z.string().trim().max(1000).optional(),
});
const paramsId = (params: unknown) => z.object({ homeworkId: id }).parse(params).homeworkId;

export const registerPilotRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/api/pilot")) return;
    const { profileId } = dependencies.forRequest(request);
    const expected = request.headers["x-rehearsal-profile"];
    if (profileId && expected && profileId !== expected) throw new PilotError("PROFILE_CHANGED");
  });
  app.get("/api/pilot", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({ language, tutorChatId: id.optional(), timezone: timezone.optional() }).parse(request.query);
    const homework = repository.pilot.homework.active(query.tutorChatId);
    return { settings: repository.pilot.store.settings(), timezone: repository.pilot.store.timezone(query.timezone),
      pending: repository.pilot.listening.pending(), homework,
      tutorStarted: Boolean(homework && repository.tutor.getCompletedClientExchange(homework.homeworkId)) };
  });
  app.get("/api/pilot/liked", async (request) => {
    const { repository } = dependencies.forRequest(request);
    z.object({ language }).parse(request.query);
    return { island: repository.pilot.queue.liked() };
  });
  app.get("/api/pilot/queue", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({ language, limit: z.coerce.number().int().min(1).max(100_000).optional(),
      timezone: timezone.optional(), topicId: z.string().min(1).max(100).optional(), homeworkId: id.optional() }).parse(request.query);
    return { items: repository.pilot.queue.list(query) };
  });
  app.get("/api/pilot/cards/:cardId", async (request) => {
    const { repository } = dependencies.forRequest(request);
    z.object({ language }).parse(request.query);
    const { cardId } = z.object({ cardId: z.string().min(1).max(100) }).parse(request.params);
    const item = repository.pilot.store.item(cardId);
    return { ...repository.pilot.store.progress(cardId), liked: item.preference === "like" };
  });
  app.post("/api/pilot/listens", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({ language, eventId: id, appearanceId: id, listenSessionId: id,
      cardId: z.string().min(1).max(100), completedAt: timestamp,
      audioRepeatsInAppearance: z.number().int().min(1).max(100) }).parse(request.body);
    return repository.pilot.listening.complete(body);
  });
  app.post("/api/pilot/likes", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({ language, eventId: id, cardId: z.string().min(1).max(100),
      liked: z.boolean(), occurredAt: timestamp }).parse(request.body);
    return repository.pilot.listening.like(body);
  });
  app.post("/api/pilot/attempts/start", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({ language, attemptId: id, cardId: z.string().min(1).max(100),
      homeworkId: id.optional(), shownAt: timestamp, timezone }).parse(request.body);
    const result = repository.pilot.recall.begin(body);
    return { attemptId: result.attempt_id, shownAt: result.shown_at, submitted: result.rated_at !== null };
  });
  app.post("/api/pilot/attempts/grade", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const { language: _language, ...body } = z.object({ language, attemptId: id, revealedAt: timestamp, ratedAt: timestamp,
      responseTimeMs: z.number().min(0).max(86_400_000).nullable(),
      rating: z.enum(["again", "hard", "good", "easy"]),
      inputMode: z.enum(["oral_self_check", "typed", "voice_optional"]),
      answer: z.string().max(4000).transform((value) => value.normalize("NFC")) }).parse(request.body);
    return repository.pilot.recall.grade(body);
  });
  app.post("/api/pilot/attempts/check", async (request) => {
    const { repository, openai } = dependencies.forRequest(request);
    const body = z.object({ language, attemptId: id,
      answer: z.string().trim().min(1).max(4000).transform((value) => value.normalize("NFC")) }).parse(request.body);
    const attempt = repository.pilot.recall.get(body.attemptId);
    if (!attempt) throw new PilotError("ATTEMPT_NOT_FOUND", 404);
    const item = repository.pilot.store.item(attempt.card_id);
    try { return { check: await openai.checkRecall(item, body.answer, body.attemptId) }; }
    catch { throw new PilotError("RECALL_CHECK_UNAVAILABLE", 503); }
  });
  app.post("/api/pilot/homework", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({ language, homeworkId: id, tutorChatId: id.optional(),
      requestedMinutes: z.number().int().min(1).max(1440), timezone }).parse(request.body);
    return { homework: repository.pilot.homework.create(body) };
  });
  app.get("/api/pilot/homework", async (request) => {
    const { repository } = dependencies.forRequest(request);
    z.object({ language }).parse(request.query);
    return { sessions: repository.pilot.homework.list() };
  });
  app.get("/api/pilot/homework/:homeworkId", async (request) => {
    const { repository } = dependencies.forRequest(request);
    z.object({ language }).parse(request.query);
    const homeworkId = paramsId(request.params);
    return { homework: repository.pilot.store.homework(homeworkId), tutorStarted: Boolean(repository.tutor.getCompletedClientExchange(homeworkId)) };
  });
  for (const action of ["return", "finish", "cancel", "continue"] as const) {
    app.post(`/api/pilot/homework/:homeworkId/${action}`, async (request) => {
      const { repository } = dependencies.forRequest(request);
      z.object({ language }).parse(request.body);
      const homeworkId = paramsId(request.params);
      const service = repository.pilot.homework;
      const homework = action === "return" ? service.returnToTutor(homeworkId)
        : action === "finish" ? service.finish(homeworkId)
          : action === "cancel" ? service.cancel(homeworkId) : service.continue(homeworkId);
      return { homework };
    });
  }
  app.post("/api/pilot/homework/:homeworkId/time", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const { language: _language, ...body } = z.object({ language, eventId: id, stage: z.enum(["recall", "tutor"]),
      intervals: z.array(z.object({ start: timestamp, end: timestamp })).max(1000), measurementLost: z.boolean() }).parse(request.body);
    return { homework: repository.pilot.timing.record(paramsId(request.params), body) };
  });
  app.post("/api/pilot/homework/:homeworkId/feedback", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const { language: _language, ...body } = feedbackSchema.extend({ language }).parse(request.body);
    return { homework: repository.pilot.homework.feedback(paramsId(request.params), body) };
  });
};
