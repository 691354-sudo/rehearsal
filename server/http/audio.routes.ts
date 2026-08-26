import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requiresStrictElevenLabs,
  type StrictElevenLabsLanguageCode,
} from "../../contracts/api.js";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, languageSchema, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";

const strictAudioCopy: Record<StrictElevenLabsLanguageCode, { name: string; errorPrefix: string }> = {
  vi: { name: "Vietnamese", errorPrefix: "VIETNAMESE" },
  no: { name: "Norwegian", errorPrefix: "NORWEGIAN" },
  id: { name: "Bahasa Indonesia", errorPrefix: "INDONESIAN" },
};

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
    const strictLanguage = body.language !== "ru" && requiresStrictElevenLabs(body.language)
      ? body.language : null;
    if (strictLanguage && body.provider !== "elevenlabs") {
      const copy = strictAudioCopy[strictLanguage];
      return reply.code(400).send({
        error: `${copy.errorPrefix}_ELEVENLABS_REQUIRED`,
        message: `${copy.name} playback requires a compatible ElevenLabs voice.`,
      });
    }
    if (strictLanguage && body.modelId !== "eleven_flash_v2_5") {
      const copy = strictAudioCopy[strictLanguage];
      return reply.code(400).send({
        error: `${copy.errorPrefix}_MODEL_UNSUPPORTED`,
        message: `${copy.name} playback requires Eleven Flash v2.5.`,
      });
    }
    if (body.provider === "elevenlabs" && body.speed !== undefined
      && (body.speed < elevenLabsSpeedRange.min || body.speed > elevenLabsSpeedRange.max)) {
      return reply.code(400).send({
        error: "INVALID_ELEVENLABS_SPEED",
        message: `ElevenLabs speed must be between ${elevenLabsSpeedRange.min} and ${elevenLabsSpeedRange.max}.`,
      });
    }
    const voiceId = body.provider === "elevenlabs" && body.language !== "ru"
      ? await elevenlabs.compatibleVoiceId(body.language, body.voiceId) : body.voiceId;
    const result = body.provider === "elevenlabs"
      ? await elevenlabs.speech({ ...body, voiceId }) : await openai.speech(body);
    return reply
      .header("X-AI-Generated-Audio", "true")
      .header("X-Audio-Cache", result.cached ? "HIT" : "MISS")
      .type("audio/mpeg")
      .send(result.audio);
  });

  app.post("/api/audio/prepare", async (request, reply) => {
    const { audioPreparation, elevenlabs } = dependencies.forRequest(request);
    const body = z.object({
      itemIds: z.array(z.string().trim().min(1).max(100)).min(1).max(50)
        .transform((itemIds) => [...new Set(itemIds)]),
      priorityItemId: z.string().trim().min(1).max(100).optional(),
    }).and(speechSettingsSchema.omit({ language: true }).extend({ language: languageSchema })).parse(request.body);
    if (body.priorityItemId && !body.itemIds.includes(body.priorityItemId)) {
      return reply.code(400).send({ error: "AUDIO_PRIORITY_ITEM_NOT_FOUND" });
    }
    const strictLanguage = requiresStrictElevenLabs(body.language) ? body.language : null;
    if (strictLanguage && body.provider !== "elevenlabs") {
      return reply.code(400).send({
        error: `${strictAudioCopy[strictLanguage].errorPrefix}_ELEVENLABS_REQUIRED`,
      });
    }
    if (strictLanguage && body.modelId !== "eleven_flash_v2_5") {
      return reply.code(400).send({
        error: `${strictAudioCopy[strictLanguage].errorPrefix}_MODEL_UNSUPPORTED`,
      });
    }
    if (body.provider === "elevenlabs" && body.speed !== undefined
      && (body.speed < elevenLabsSpeedRange.min || body.speed > elevenLabsSpeedRange.max)) {
      return reply.code(400).send({ error: "INVALID_ELEVENLABS_SPEED" });
    }
    const voiceId = body.provider === "elevenlabs"
      ? await elevenlabs.compatibleVoiceId(body.language, body.voiceId)
      : body.voiceId;
    const job = audioPreparation.prepare(body.itemIds, { ...body, voiceId }, body.priorityItemId);
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
