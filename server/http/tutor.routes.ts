import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { languageSchema, reviewCandidateSelectionSchema } from "./schemas.js";

export const registerTutorRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  const { repository, openai, tutor } = dependencies;

  app.get("/api/chat/threads", async (request) => {
    const query = z.object({
      language: languageSchema,
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    return { threads: repository.tutor.listThreads(query.language, query.limit) };
  });

  app.get("/api/chat/:threadId/messages", async (request, reply) => {
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const thread = repository.tutor.getThread(params.threadId);
    if (!thread) return reply.code(404).send({ error: "THREAD_NOT_FOUND" });
    return {
      thread: {
        publicId: thread.public_id,
        language: thread.language_code,
        title: thread.title,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      },
      messages: repository.tutor.getMessages(thread.id, 200),
    };
  });

  app.post("/api/chat", async (request) => {
    const body = z.object({
      language: languageSchema,
      message: z.string().trim().min(1).max(30_000),
      threadId: z.string().uuid().optional(),
    }).parse(request.body);
    return tutor.chat({ language: body.language, message: body.message, threadPublicId: body.threadId });
  });

  app.post("/api/chat/:threadId/review", async (request, reply) => {
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const result = await tutor.review(params.threadId);
    return result ? reply.code(201).send(result) : reply.code(404).send({ error: "THREAD_NOT_FOUND" });
  });

  app.post("/api/review-batches/vocab", async (request, reply) => {
    const body = z.object({
      language: languageSchema,
      title: z.string().trim().min(1).max(300).default("Vocabulary review"),
      text: z.string().trim().min(1).max(100_000),
      threadId: z.string().uuid().optional(),
    }).parse(request.body);
    const thread = repository.tutor.getOrCreateThread(body.threadId, body.language);
    repository.tutor.addMessage(thread.id, "user", body.text);
    repository.tutor.ensureThreadTitle(thread.id, body.text);
    const source = repository.library.saveSource({
      language: body.language,
      title: body.title,
      rawText: body.text,
      kind: "vocab",
    });
    const prepared = await openai.prepareVocabBatch({ ...body, sourceThreadPublicId: thread.publicId });
    const content = prepared.batch.candidates.length
      ? `I prepared ${prepared.batch.candidates.length} options. Nothing has been added to Library yet.`
      : "The vocabulary list is saved. No suggestions were generated because the language model is not connected.";
    repository.tutor.addMessage(thread.id, "assistant", content, { reviewBatchId: prepared.batch.publicId });
    return reply.code(201).send({ source, ...prepared, threadId: thread.publicId, content });
  });

  app.post("/api/review-batches/:batchId/commit", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = z.object({ candidates: z.array(reviewCandidateSelectionSchema).max(100) }).parse(request.body);
    const result = repository.reviews.commit(params.batchId, body.candidates);
    return result ? { ...result, added: result.items.length } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.get("/api/review-batches/:batchId", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const batch = repository.reviews.get(params.batchId);
    return batch ? { batch } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/revise", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = z.object({ feedback: z.string().trim().min(1).max(4_000) }).parse(request.body);
    const batch = await openai.reviseReviewBatch({ batchPublicId: params.batchId, feedback: body.feedback });
    return batch ? { batch } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/candidates/:candidateId/regenerate", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid(), candidateId: z.string().uuid() }).parse(request.params);
    const body = z.object({ instruction: z.enum(["another", "different_context"]) }).parse(request.body);
    const batch = await openai.regenerateCandidate({
      batchPublicId: params.batchId,
      candidateId: params.candidateId,
      instruction: body.instruction,
    });
    return batch ? { batch } : reply.code(404).send({ error: "REVIEW_CANDIDATE_NOT_FOUND" });
  });
};
