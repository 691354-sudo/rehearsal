import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, languageSchema, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";

export const registerAudioRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  const speechSettingsSchema = z.object({
    language: z.union([languageSchema, z.literal("ru")]),
    provider: z.enum(["openai", "elevenlabs"]).default("openai"),
    voice: z.enum(voiceOptions).optional(),
    voiceId: z.string().trim().min(1).max(100).optional(),
    modelId: z.enum(elevenLabsModelOptions).optional(),
    speed: z.number().min(0.5).max(1.5).optional(),
  });

  app.get("/api/audio/elevenlabs/status", async (request) => {
    const { elevenlabs } = dependencies.forRequest(request);
    const query = z.object({
      refresh: z.enum(["true", "false"]).default("false"),
      voiceId: z.string().trim().min(1).max(100).optional(),
    }).parse(request.query);
    return elevenlabs.voiceStatus(query.refresh === "true", query.voiceId);
  });

  app.post("/api/audio/speech", async (request, reply) => {
    const { openai, elevenlabs } = dependencies.forRequest(request);
    const body = z.object({
      text: z.string().trim().min(1).max(4_096),
    }).and(speechSettingsSchema).parse(request.body);
    if (body.language === "vi" && body.provider !== "elevenlabs") {
      return reply.code(400).send({
        error: "VIETNAMESE_ELEVENLABS_REQUIRED",
        message: "Vietnamese playback requires the configured ElevenLabs voice.",
      });
    }
    if (body.language === "vi" && body.modelId !== "eleven_flash_v2_5") {
      return reply.code(400).send({
        error: "VIETNAMESE_MODEL_UNSUPPORTED",
        message: "Vietnamese playback requires Eleven Flash v2.5.",
      });
    }
    if (body.provider === "elevenlabs" && body.speed !== undefined
      && (body.speed < elevenLabsSpeedRange.min || body.speed > elevenLabsSpeedRange.max)) {
      return reply.code(400).send({
        error: "INVALID_ELEVENLABS_SPEED",
        message: `ElevenLabs speed must be between ${elevenLabsSpeedRange.min} and ${elevenLabsSpeedRange.max}.`,
      });
    }
    const result = body.provider === "elevenlabs" ? await elevenlabs.speech(body) : await openai.speech(body);
    return reply
      .header("X-AI-Generated-Audio", "true")
      .header("X-Audio-Cache", result.cached ? "HIT" : "MISS")
      .type("audio/mpeg")
      .send(result.audio);
  });

  app.post("/api/audio/prepare", async (request, reply) => {
    const { audioPreparation } = dependencies.forRequest(request);
    const body = z.object({
      itemIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50)
        .transform((itemIds) => [...new Set(itemIds)]),
      priorityItemId: z.string().trim().min(1).max(100).optional(),
    }).and(speechSettingsSchema.omit({ language: true }).extend({ language: languageSchema })).parse(request.body);
    if (body.priorityItemId && !body.itemIds.includes(body.priorityItemId)) {
      return reply.code(400).send({ error: "AUDIO_PRIORITY_ITEM_NOT_FOUND" });
    }
    if (body.language === "vi" && body.provider !== "elevenlabs") {
      return reply.code(400).send({ error: "VIETNAMESE_ELEVENLABS_REQUIRED" });
    }
    if (body.language === "vi" && body.modelId !== "eleven_flash_v2_5") {
      return reply.code(400).send({ error: "VIETNAMESE_MODEL_UNSUPPORTED" });
    }
    if (body.provider === "elevenlabs" && body.speed !== undefined
      && (body.speed < elevenLabsSpeedRange.min || body.speed > elevenLabsSpeedRange.max)) {
      return reply.code(400).send({ error: "INVALID_ELEVENLABS_SPEED" });
    }
    const job = audioPreparation.prepare(body.itemIds, body, body.priorityItemId);
    return reply.code(job.status === "ready" ? 200 : 202).send(job);
  });

  app.get("/api/audio/prepare/:jobId", async (request, reply) => {
    const { audioPreparation } = dependencies.forRequest(request);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const job = audioPreparation.get(jobId);
    return job ? job : reply.code(404).send({ error: "AUDIO_PREPARATION_NOT_FOUND" });
  });

  app.delete("/api/audio/prepare/:jobId", async (request, reply) => {
    const { audioPreparation } = dependencies.forRequest(request);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const job = audioPreparation.cancel(jobId);
    return job ? job : reply.code(404).send({ error: "AUDIO_PREPARATION_NOT_FOUND" });
  });
};
