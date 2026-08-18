import cors from "@fastify/cors";
import Fastify from "fastify";
import type { StepUnit } from "ts-fsrs";
import { z } from "zod";
import { config, elevenLabsConfigured, openAIConfigured } from "./config.js";
import type { RehearsalRepository } from "./db/repository.js";
import type { LanguageCode } from "./types.js";
import { OpenAIService } from "./services/openai.js";
import { ElevenLabsError, ElevenLabsService } from "./services/elevenlabs.js";
import { TutorService } from "./services/tutor.js";
import { getModelRouting } from "./model-routing.js";
import type { SchedulerSettings } from "./services/scheduler.js";

const languageSchema = z.enum(["en", "lv"]);
const voiceOptions = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
  "onyx", "sage", "shimmer", "verse", "marin", "cedar",
] as const;
const elevenLabsModelOptions = ["eleven_multilingual_v2", "eleven_flash_v2_5"] as const;
const stepSchema = z.custom<StepUnit>(
  (value) => typeof value === "string" && /^\d+(?:\.\d+)?[mhd]$/.test(value),
  "Use a duration such as 1m, 2h, or 1d",
);
const schedulerPresetSchema = z.object({
  requestRetention: z.number().min(0.8).max(0.97),
  maximumInterval: z.number().int().min(7).max(3650),
});
const schedulerSettingsSchema = z.object({
  presets: z.object({
    like: schedulerPresetSchema,
    neutral: schedulerPresetSchema,
    dislike: schedulerPresetSchema,
  }),
  learningSteps: z.array(stepSchema).min(1).max(4),
  relearningSteps: z.array(stepSchema).min(1).max(4),
  fuzz: z.boolean(),
  newItemsPerDay: z.number().int().min(0).max(30).default(10),
}) satisfies z.ZodType<SchedulerSettings>;

const itemBodySchema = z.object({
  language: languageSchema,
  target: z.string().trim().min(1).max(2_000),
  cue: z.string().trim().min(1).max(2_000),
  note: z.string().trim().max(2_000).optional(),
  kind: z.enum(["phrase", "island_line", "correction", "story_line"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]).optional(),
});

const reviewCandidateSelectionSchema = z.object({
  id: z.string().uuid(),
  target: z.string().trim().min(1).max(2_000),
  cue: z.string().trim().min(1).max(2_000),
  note: z.string().trim().max(2_000),
  category: z.string().trim().max(80),
});

const toErrorResponse = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return { statusCode: 400, body: { error: "INVALID_REQUEST", details: error.issues } };
  }
  if (error instanceof Error && error.message === "OPENAI_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      body: { error: "OPENAI_NOT_CONFIGURED", message: "Add OPENAI_API_KEY to .env and restart the API." },
    };
  }
  if (error instanceof Error && error.message === "ELEVENLABS_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      body: { error: "ELEVENLABS_NOT_CONFIGURED", message: "Add ELEVENLABS_API_KEY to .env and restart the API." },
    };
  }
  if (error instanceof ElevenLabsError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.code, message: error.message },
    };
  }
  return {
    statusCode: 500,
    body: { error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unknown error" },
  };
};

export const buildApp = async (repository: RehearsalRepository) => {
  const app = Fastify({ logger: true, bodyLimit: 2_000_000 });
  const openai = new OpenAIService(repository);
  const elevenlabs = new ElevenLabsService(repository);
  const tutor = new TutorService(repository, openai);

  await app.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/],
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const response = toErrorResponse(error);
    void reply.code(response.statusCode).send(response.body);
  });

  app.get("/health", async () => {
    const routing = getModelRouting();
    return {
      ok: true,
      database: "sqlite",
      openaiConfigured: openAIConfigured,
      elevenLabsConfigured: elevenLabsConfigured,
      models: openAIConfigured
        ? {
            tutor: routing.tutor,
            balanced: routing.balanced,
            utility: routing.utility,
            routingSource: routing.source,
            routingCheckedAt: routing.checkedAt,
            embeddings: config.embeddingModel,
            tts: config.ttsModel,
            voice: config.ttsVoice,
          }
        : null,
      stats: repository.stats(),
    };
  });

  app.get("/api/config", async () => ({
    openaiConfigured: openAIConfigured,
    tts: {
      disclosure: "Голос сгенерирован искусственным интеллектом.",
      providers: {
        openai: {
          configured: openAIConfigured,
          defaultVoice: config.ttsVoice,
          voices: voiceOptions,
          recommendedVoices: ["marin", "cedar"],
        },
        elevenlabs: {
          configured: elevenLabsConfigured,
          voice: { id: config.elevenLabsVoiceId, name: config.elevenLabsVoiceName },
          models: elevenLabsModelOptions,
          defaults: {
            modelId: config.elevenLabsModel,
            stability: config.elevenLabsStability,
            similarityBoost: config.elevenLabsSimilarityBoost,
            style: config.elevenLabsStyle,
            speakerBoost: config.elevenLabsSpeakerBoost,
            speed: config.elevenLabsSpeed,
          },
          note: "Library voices require a paid ElevenLabs API plan.",
        },
      },
    },
    scheduler: {
      algorithm: "FSRS-6",
      ...repository.getSchedulerSettings(),
    },
    languages: [
      { code: "en", label: "English", locale: "en-US" },
      { code: "lv", label: "Latviešu", locale: "lv-LV" },
    ],
  }));

  app.patch("/api/settings/scheduler", async (request) => ({
    scheduler: repository.updateSchedulerSettings(schedulerSettingsSchema.parse(request.body)),
  }));

  app.get("/api/items", async (request) => {
    const query = z
      .object({ language: languageSchema.default("en"), limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    return { items: repository.listItems(query.language, query.limit) };
  });

  app.post("/api/items", async (request, reply) => {
    const body = itemBodySchema.parse(request.body);
    const item = repository.saveItem({
      ...body,
      source: "Manual entry",
      naturalness: 5,
      commonness: 5,
      status: "new",
      register: "casual",
    });
    return reply.code(201).send({ item });
  });

  app.patch("/api/items/:itemId/preference", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = z.object({ preference: z.enum(["like", "neutral", "dislike"]) }).parse(request.body);
    const item = repository.updateItemPreference(params.itemId, body.preference);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    return { item };
  });

  app.patch("/api/items/:itemId", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      target: z.string().trim().min(1).max(2_000).optional(),
      cue: z.string().trim().min(1).max(2_000).optional(),
      note: z.string().trim().max(2_000).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
      preference: z.enum(["like", "neutral", "dislike"]).optional(),
      frequencyBand: z.enum(["core", "common", "specific", "rare"]).optional(),
      practiceEnabled: z.boolean().optional(),
    }).parse(request.body);
    const item = repository.updateItem(params.itemId, body);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    return { item };
  });

  app.delete("/api/items/:itemId", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    if (!repository.deleteItem(params.itemId)) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    return reply.code(204).send();
  });

  app.get("/api/search", async (request) => {
    const query = z
      .object({
        q: z.string().trim().min(1).max(500),
        language: languageSchema.default("en"),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    const embedding = await openai.embed(query.q);
    return {
      items: repository.search(query.q, query.language, embedding || undefined, query.limit),
      mode: embedding ? "hybrid" : "keyword",
    };
  });

  app.get("/api/practice/due", async (request) => {
    const query = z
      .object({
        language: languageSchema.default("en"),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        newLimit: z.coerce.number().int().min(0).max(30).optional(),
      })
      .parse(request.query);
    const newLimit = query.newLimit ?? repository.getSchedulerSettings().newItemsPerDay;
    return { items: repository.listDueItems(query.language, query.limit, new Date(), newLimit) };
  });

  app.get("/api/practice/progress", async (request) => {
    const query = z
      .object({
        language: languageSchema.default("en"),
        since: z.string().datetime(),
      })
      .parse(request.query);
    const activity = repository.countActivitySince(query.language, query.since);
    return { completed: activity.recall, ...activity };
  });

  app.post("/api/attempts/evaluate", async (request, reply) => {
    const body = z
      .object({
        itemId: z.string().min(1),
        answer: z.string().trim().min(1).max(4_000),
        mode: z.enum(["recall", "shadow", "listen"]).default("recall"),
        rating: z.enum(["again", "hard", "good", "easy"]).optional(),
      })
      .parse(request.body);
    const item = repository.getItem(body.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    const result = openai.evaluate(item, body.answer);
    const scoreByRating = { again: 0, hard: 0.7, good: 0.85, easy: 1 } as const;
    const rating = body.rating || ({ exact: "good", close: "hard", retry: "again" } as const)[result.evaluation.verdict];
    const attempt = repository.recordAttempt({
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
    const body = z
      .object({
        itemId: z.string().min(1),
        mode: z.literal("shadow"),
        rating: z.enum(["again", "hard", "good", "easy"]),
      })
      .parse(request.body);
    const item = repository.getItem(body.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });

    const scoreByRating = { again: 0, hard: 0.7, good: 0.85, easy: 1 } as const;
    const review = repository.recordAttempt({
      itemPublicId: item.publicId,
      mode: body.mode,
      answer: "",
      score: scoreByRating[body.rating],
      verdict: body.rating,
      feedback: { rating: body.rating },
    });
    return { rating: body.rating, review };
  });

  app.post("/api/audio/speech", async (request, reply) => {
    const body = z
      .object({
        text: z.string().trim().min(1).max(4_096),
        language: z.enum(["en", "lv", "ru"]),
        provider: z.enum(["openai", "elevenlabs"]).default("openai"),
        voice: z.enum(voiceOptions).optional(),
        voiceId: z.string().trim().min(1).max(100).optional(),
        modelId: z.enum(elevenLabsModelOptions).optional(),
        stability: z.number().min(0).max(1).optional(),
        similarityBoost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speakerBoost: z.boolean().optional(),
        speed: z.number().min(0.5).max(1.5).optional(),
      })
      .parse(request.body);
    const result = body.provider === "elevenlabs"
      ? await elevenlabs.speech(body)
      : await openai.speech(body);
    return reply
      .header("X-AI-Generated-Audio", "true")
      .header("X-Audio-Cache", result.cached ? "HIT" : "MISS")
      .type("audio/mpeg")
      .send(result.audio);
  });

  app.post("/api/import/text", async (request, reply) => {
    const body = z
      .object({
        language: languageSchema,
        title: z.string().trim().min(1).max(300),
        text: z.string().trim().min(1).max(200_000),
      })
      .parse(request.body);
    const source = repository.saveSource({
      language: body.language,
      title: body.title,
      rawText: body.text,
      kind: "text",
    });
    const prepared = await openai.prepareImportedMaterial(body);
    const previewSentences = body.text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .slice(0, 50);
    return reply.code(201).send({ source, prepared, batch: prepared.batch, previewSentences });
  });

  app.get("/api/chat/threads", async (request) => {
    const query = z.object({
      language: languageSchema,
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(request.query);
    return { threads: repository.listThreads(query.language, query.limit) };
  });

  app.get("/api/chat/:threadId/messages", async (request, reply) => {
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const thread = repository.getThread(params.threadId);
    if (!thread) return reply.code(404).send({ error: "THREAD_NOT_FOUND" });
    return {
      thread: {
        publicId: thread.public_id,
        language: thread.language_code,
        title: thread.title,
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      },
      messages: repository.getMessages(thread.id, 200),
    };
  });

  app.post("/api/chat", async (request) => {
    const body = z
      .object({
        language: languageSchema,
        message: z.string().trim().min(1).max(30_000),
        threadId: z.string().uuid().optional(),
      })
      .parse(request.body);
    return tutor.chat({
      language: body.language,
      message: body.message,
      threadPublicId: body.threadId,
    });
  });

  app.post("/api/chat/:threadId/review", async (request, reply) => {
    const params = z.object({ threadId: z.string().uuid() }).parse(request.params);
    const result = await tutor.review(params.threadId);
    if (!result) return reply.code(404).send({ error: "THREAD_NOT_FOUND" });
    return reply.code(201).send(result);
  });

  app.post("/api/review-batches/vocab", async (request, reply) => {
    const body = z.object({
      language: languageSchema,
      title: z.string().trim().min(1).max(300).default("Vocabulary review"),
      text: z.string().trim().min(1).max(100_000),
      threadId: z.string().uuid().optional(),
    }).parse(request.body);
    const thread = repository.getOrCreateThread(body.threadId, body.language);
    repository.addMessage(thread.id, "user", body.text);
    repository.ensureThreadTitle(thread.id, body.text);
    const source = repository.saveSource({
      language: body.language,
      title: body.title,
      rawText: body.text,
      kind: "vocab",
    });
    const prepared = await openai.prepareVocabBatch({ ...body, sourceThreadPublicId: thread.publicId });
    const content = prepared.batch.candidates.length
      ? `I prepared ${prepared.batch.candidates.length} options. Nothing has been added to Library yet.`
      : "The vocabulary list is saved. No suggestions were generated because the language model is not connected.";
    repository.addMessage(thread.id, "assistant", content, { reviewBatchId: prepared.batch.publicId });
    return reply.code(201).send({ source, ...prepared, threadId: thread.publicId, content });
  });

  app.post("/api/review-batches/:batchId/commit", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const body = z.object({ candidates: z.array(reviewCandidateSelectionSchema).max(100) }).parse(request.body);
    const result = repository.commitReviewBatch(params.batchId, body.candidates);
    if (!result) return reply.code(404).send({ error: "REVIEW_BATCH_NOT_FOUND" });
    return { ...result, added: result.items.length };
  });

  app.post("/api/review-batches/:batchId/candidates/:candidateId/regenerate", async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid(), candidateId: z.string().uuid() }).parse(request.params);
    const body = z.object({ instruction: z.enum(["another", "different_context"]) }).parse(request.body);
    const batch = await openai.regenerateCandidate({
      batchPublicId: params.batchId,
      candidateId: params.candidateId,
      instruction: body.instruction,
    });
    if (!batch) return reply.code(404).send({ error: "REVIEW_CANDIDATE_NOT_FOUND" });
    return { batch };
  });

  app.post("/api/items/:itemId/pattern-drill", async (request, reply) => {
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const item = repository.getItem(params.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    const result = await openai.generatePatternDrill({ language: item.language, item });
    return reply.code(201).send(result);
  });

  app.post("/api/islands", async (request, reply) => {
    const body = z
      .object({
        language: languageSchema,
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2_000).optional(),
        itemIds: z.array(z.string()).max(100).default([]),
      })
      .parse(request.body);
    return reply.code(201).send({
      island: repository.createIsland({
        language: body.language,
        title: body.title,
        description: body.description,
        itemPublicIds: body.itemIds,
      }),
    });
  });

  return app;
};

export type AppLanguage = LanguageCode;
