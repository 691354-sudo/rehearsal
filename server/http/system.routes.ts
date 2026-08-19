import type { FastifyInstance } from "fastify";
import { config, elevenLabsConfigured, openAIConfigured } from "../config.js";
import { getModelRouting } from "../model-routing.js";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, schedulerSettingsSchema, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";

export const registerSystemRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  const { repository } = dependencies;

  app.get("/health", async () => {
    const routing = getModelRouting();
    return {
      ok: true,
      database: "sqlite",
      openaiConfigured: openAIConfigured,
      elevenLabsConfigured,
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
      stats: repository.system.stats(),
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
          speedRange: elevenLabsSpeedRange,
          defaults: {
            modelId: config.elevenLabsModel,
            stability: config.elevenLabsStability,
            similarityBoost: config.elevenLabsSimilarityBoost,
            style: config.elevenLabsStyle,
            speakerBoost: config.elevenLabsSpeakerBoost,
            speed: config.elevenLabsSpeed,
          },
          note: "Generated MP3 files are cached on this server. Identical requests reuse the cached audio.",
        },
      },
    },
    scheduler: { algorithm: "FSRS-6", ...repository.practice.getSettings() },
    languages: [
      { code: "en", label: "English", locale: "en-US" },
      { code: "lv", label: "Latviešu", locale: "lv-LV" },
    ],
  }));

  app.patch("/api/settings/scheduler", async (request) => ({
    scheduler: repository.practice.updateSettings(schedulerSettingsSchema.parse(request.body)),
  }));
};
