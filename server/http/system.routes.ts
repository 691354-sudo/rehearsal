import type { FastifyInstance } from "fastify";
import { config, elevenLabsConfigured, openAIConfigured } from "../config.js";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, schedulerSettingsSchema, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";

export const registerSystemRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/health", async () => {
    return {
      ok: true,
      database: "sqlite",
      openaiConfigured: openAIConfigured,
      elevenLabsConfigured,
      models: openAIConfigured
        ? {
            tutor: config.tutorModel,
            balanced: config.balancedModel,
            utility: config.utilityModel,
            embeddings: config.embeddingModel,
            tts: config.ttsModel,
            voice: config.ttsVoice,
          }
        : null,
      profiles: dependencies.health(),
    };
  });

  app.get("/api/config", async (request) => {
    const { elevenlabs, repository } = dependencies.forRequest(request);
    const voicesByLanguage = await elevenlabs.voicesByLanguage();
    return {
      openaiConfigured: openAIConfigured,
      tts: {
        disclosure: "Голос сгенерирован искусственным интеллектом.",
        providers: {
          openai: {
            configured: openAIConfigured,
            defaultVoice: config.ttsVoice,
            voices: voiceOptions,
            recommendedVoices: ["onyx"],
          },
          elevenlabs: {
            configured: elevenLabsConfigured,
            voice: { id: config.elevenLabsVoiceId, name: config.elevenLabsVoiceName },
            voicesByLanguage,
            models: elevenLabsModelOptions,
            speedRange: elevenLabsSpeedRange,
            defaults: {
              voiceId: config.elevenLabsVoiceId,
              modelId: config.elevenLabsModel,
              speed: config.elevenLabsSpeed,
            },
            languageDefaults: {
              vi: {
                voiceId: config.elevenLabsViVoiceId,
                voiceName: config.elevenLabsViVoiceName,
                modelId: "eleven_flash_v2_5",
              },
              ...(config.elevenLabsNoVoiceId ? {
                no: {
                  voiceId: config.elevenLabsNoVoiceId,
                  voiceName: config.elevenLabsNoVoiceName,
                  modelId: "eleven_flash_v2_5" as const,
                },
              } : {}),
            },
            note: "Generated MP3 files are cached on this server. Identical requests reuse the cached audio.",
          },
        },
      },
      scheduler: { algorithm: "FSRS-6", ...repository.practice.getSettings() },
      languages: repository.system.listLanguages(),
    };
  });

  app.patch("/api/settings/scheduler", async (request) => {
    const { repository } = dependencies.forRequest(request);
    return { scheduler: repository.practice.updateSettings(schedulerSettingsSchema.parse(request.body)) };
  });
};
