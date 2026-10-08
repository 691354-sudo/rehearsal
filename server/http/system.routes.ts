import type { FastifyInstance } from "fastify";
import { config, elevenLabsConfigured, openAIConfigured } from "../config.js";
import type { HttpDependencies } from "./dependencies.js";
import { elevenLabsModelOptions, schedulerSettingsSchema, voiceOptions } from "./schemas.js";
import { elevenLabsSpeedRange } from "../services/elevenlabs.js";
import { z } from "zod";
import { languageSchema } from "./schemas.js";
import { playbackPatchSchema, playbackPreferencesSchema } from "../../contracts/playback-preferences.js";

export const registerSystemRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/settings/playback", async (request) => {
    const { language } = z.object({ language: languageSchema }).parse(request.query);
    return { playback: dependencies.forRequest(request).repository.system.playback(language) };
  });
  for (const method of ["PATCH", "POST"] as const) app.route({ method, url: "/api/settings/playback", handler: async (request) => {
    const body = z.object({ language: languageSchema, playback: method === "POST" ? playbackPreferencesSchema : playbackPatchSchema }).strict().parse(request.body);
    const defaults = { provider: "openai" as const, repetitions: 2 as const, speed: 1, playAfterRecall: true,
      voice: "onyx" as const, elevenlabs: { voiceId: "", modelId: "eleven_multilingual_v2" as const } };
    return { playback: dependencies.forRequest(request).repository.system.savePlayback(body.language, body.playback, defaults, method === "POST") };
  } });
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
    const voices = [...new Map(Object.values(voicesByLanguage).flat()
      .map((voice) => [voice.id, voice])).values()];
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
            voices,
            voicesByLanguage,
            models: elevenLabsModelOptions,
            speedRange: elevenLabsSpeedRange,
            defaults: {
              voiceId: config.elevenLabsVoiceId,
              modelId: config.elevenLabsModel,
              speed: config.elevenLabsSpeed,
            },
            languageDefaults: {
              de: { voiceId: config.elevenLabsDeVoiceId, voiceName: "Justin Time", modelId: "eleven_flash_v2_5" as const },
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
              id: {
                voiceId: config.elevenLabsIdVoiceId,
                voiceName: config.elevenLabsIdVoiceName,
                modelId: "eleven_flash_v2_5" as const,
              },
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
