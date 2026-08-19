import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";

export const registerAudioRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  const { openai, elevenlabs } = dependencies;

  app.get("/api/audio/elevenlabs/status", async (request) => {
    const query = z.object({ refresh: z.enum(["true", "false"]).default("false") }).parse(request.query);
    return elevenlabs.voiceStatus(query.refresh === "true");
  });

  app.post("/api/audio/speech", async (request, reply) => {
    const body = z.object({
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
    }).parse(request.body);
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
};
