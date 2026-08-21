import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { aiLimits } from "../services/ai-limits.js";
import { audioUploadExtension } from "./audio-upload.js";
import { languageSchema, reviewCandidateSelectionSchema } from "./schemas.js";

const reviewResolutionSchema = z.object({
  accepted: z.array(reviewCandidateSelectionSchema).max(100),
  revisions: z.array(reviewCandidateSelectionSchema.extend({
    feedback: z.string().trim().min(1).max(1_000),
  })).max(100),
}).refine(({ accepted, revisions }) => {
  const acceptedIds = new Set(accepted.map((candidate) => candidate.id));
  return revisions.every((candidate) => !acceptedIds.has(candidate.id));
}, "A candidate cannot be accepted and revised together");

export const registerTutorRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/chat/threads", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({
      language: languageSchema,
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    return { threads: repository.tutor.listThreads(query.language, query.limit) };
  });

  app.get("/api/chat/:threadId/messages", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
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

  app.delete("/api/chat/:threadId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    if (!repository.tutor.deleteThread(params.threadId)) {
      return reply.code(404).send({ error: "THREAD_NOT_FOUND" });
    }
    return reply.code(204).send();
  });

  app.post("/api/chat", async (request) => {
    const { tutor } = dependencies.forRequest(request);
    const body = z.object({
      language: languageSchema,
      message: z.string().trim().min(1).max(aiLimits.tutorMessageCharacters),
      threadId: z.string().uuid().optional(),
    }).parse(request.body);
    return tutor.chat({ language: body.language, message: body.message, threadPublicId: body.threadId });
  });

  app.post("/api/chat/transcribe", async (request, reply) => {
    const { openai } = dependencies.forRequest(request);
    const query = z.object({ language: languageSchema }).parse(request.query);
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED" });
    const mime = upload.mimetype.toLocaleLowerCase().split(";")[0];
    const extension = audioUploadExtension(mime);
    if (!extension) {
      await upload.toBuffer();
      return reply.code(415).send({ error: "UNSUPPORTED_AUDIO_TYPE", mime });
    }
    const audio = await upload.toBuffer();
    if (!audio.byteLength) return reply.code(422).send({ error: "EMPTY_AUDIO" });
    try {
      const languages = {
        en: ["en", "ru"],
        lv: ["lv", "ru", "en"],
        vi: ["vi", "ru", "en"],
      }[query.language];
      const transcript = await openai.transcribe({
        audio,
        audioMime: mime,
        filename: `tutor-message.${extension}`,
        languages,
        prompt: "A conversational message to a language tutor. Preserve the language and wording the speaker used.",
      });
      return { transcript };
    } catch {
      return reply.code(503).send({ error: "TRANSCRIPTION_FAILED" });
    }
  });

  app.post("/api/chat/:threadId/review", async (request, reply) => {
    const { tutor } = dependencies.forRequest(request);
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const result = await tutor.review(params.threadId);
    return result ? reply.code(201).send(result) : reply.code(404).send({ error: "THREAD_NOT_FOUND" });
  });

  app.post("/api/review-batches/vocab", async (request, reply) => {
    const { repository, openai } = dependencies.forRequest(request);
    const body = z.object({
      language: languageSchema,
      title: z.string().trim().min(1).max(300).default("Vocabulary review"),
      text: z.string().trim().min(1).max(aiLimits.sourceCharacters),
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
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = z.object({ candidates: z.array(reviewCandidateSelectionSchema).max(100) }).parse(request.body);
    const result = repository.reviews.commit(params.batchId, body.candidates);
    return result ? { ...result, added: result.items.length } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.get("/api/review-batches/:batchId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const batch = repository.reviews.get(params.batchId);
    return batch ? { batch } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/revise", async (request, reply) => {
    const { openai } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = z.object({ feedback: z.string().trim().min(1).max(4_000) }).parse(request.body);
    const batch = await openai.reviseReviewBatch({ batchPublicId: params.batchId, feedback: body.feedback });
    return batch ? { batch } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/resolve-capture", async (request, reply) => {
    const { openai } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = reviewResolutionSchema.parse(request.body);
    const result = await openai.resolveCaptureReview({ batchPublicId: params.batchId, ...body });
    return result ? { ...result, added: result.items.length } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/resolve", async (request, reply) => {
    const { openai } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = reviewResolutionSchema.parse(request.body);
    const result = await openai.resolveReview({ batchPublicId: params.batchId, ...body });
    return result ? { ...result, added: result.items.length } : reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/reset-capture", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const notes = repository.reviews.resetCapture(params.batchId);
    return notes ? { reset: true, notes } : reply.code(404).send({ error: "CAPTURE_REVIEW_NOT_FOUND" });
  });

  app.post("/api/review-batches/:batchId/candidates/:candidateId/regenerate", async (request, reply) => {
    const { openai } = dependencies.forRequest(request);
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
