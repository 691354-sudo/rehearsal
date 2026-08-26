import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { ElevenLabsService } from "../services/elevenlabs.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("audio API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("exposes compatible OpenAI and ElevenLabs defaults", async () => {
    const app = await buildApp(context.repository);
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json().tts.providers.openai).toMatchObject({
      defaultVoice: "onyx",
      recommendedVoices: ["onyx"],
    });
    expect(response.json().tts.providers.elevenlabs).toMatchObject({
      voice: { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
      voices: expect.arrayContaining([
        { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
        { id: "ueSxRO0nLF1bj93J2hVt", name: "Trung Caha" },
      ]),
      voicesByLanguage: {
        en: expect.arrayContaining([
          { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
          { id: "kdnRe2koJdOK4Ovxn2DI", name: "Eryn" },
        ]),
        id: [{ id: "3mAVBNEqop5UbHtD8oxQ", name: "Zephlyn" }],
        vi: [{ id: "ueSxRO0nLF1bj93J2hVt", name: "Trung Caha" }],
        no: [],
      },
      speedRange: { min: 0.7, max: 1.2 },
      languageDefaults: {
        id: { voiceId: "3mAVBNEqop5UbHtD8oxQ", voiceName: "Zephlyn", modelId: "eleven_flash_v2_5" },
        vi: { voiceId: "ueSxRO0nLF1bj93J2hVt", voiceName: "Trung Caha", modelId: "eleven_flash_v2_5" },
      },
    });
    await app.close();
  });

  it("exposes the saved voices returned by ElevenLabs", async () => {
    const voicesByLanguage = vi.fn().mockResolvedValue({
      en: [{ id: "saved-voice", name: "Saved Voice" }], lv: [], vi: [], no: [], id: [],
    });
    const app = await buildApp(context.repository, {
      elevenlabs: { voicesByLanguage } as unknown as ElevenLabsService,
    });
    const response = await app.inject({ method: "GET", url: "/api/config" });

    expect(response.json().tts.providers.elevenlabs.voicesByLanguage.en).toEqual([
      { id: "saved-voice", name: "Saved Voice" },
    ]);
    expect(response.json().tts.providers.elevenlabs.voices).toEqual([
      { id: "saved-voice", name: "Saved Voice" },
    ]);
    expect(voicesByLanguage).toHaveBeenCalledOnce();
    await app.close();
  });

  it("reports whether the configured ElevenLabs voice is reachable", async () => {
    const voiceStatus = vi.fn().mockResolvedValue({
      configured: true,
      reachable: true,
      checkedAt: "2026-08-19T12:00:00.000Z",
      voice: {
        id: "voice-id",
        name: "Verified voice",
        category: "professional",
        description: "A test voice",
        labels: { accent: "american" },
      },
      error: "",
    });
    const app = await buildApp(context.repository, {
      elevenlabs: { voiceStatus } as unknown as ElevenLabsService,
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/audio/elevenlabs/status?refresh=true&voiceId=kdnRe2koJdOK4Ovxn2DI",
    });
    expect(response.json()).toMatchObject({ reachable: true, voice: { name: "Verified voice" } });
    expect(voiceStatus).toHaveBeenCalledWith(true, "kdnRe2koJdOK4Ovxn2DI");
    await app.close();
  });

  it("rejects ElevenLabs speeds outside the provider API range", async () => {
    const app = await buildApp(context.repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/audio/speech",
      payload: { text: "Too fast", language: "en", provider: "elevenlabs", speed: 1.5 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_ELEVENLABS_SPEED" });
    await app.close();
  });

  it("passes the selected ElevenLabs voice to speech generation", async () => {
    const speech = vi.fn().mockResolvedValue({ audio: Buffer.from([1, 2, 3]), cached: false });
    const compatibleVoiceId = vi.fn().mockImplementation(async (_language, voiceId) => voiceId);
    const app = await buildApp(context.repository, {
      elevenlabs: { compatibleVoiceId, speech } as unknown as ElevenLabsService,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/audio/speech",
      payload: {
        text: "Test Eryn.",
        language: "en",
        provider: "elevenlabs",
        voiceId: "kdnRe2koJdOK4Ovxn2DI",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({
      voiceId: "kdnRe2koJdOK4Ovxn2DI",
    }));
    await app.close();
  });

  it("prepares cached and missing card audio with an explicit priority card", async () => {
    const cachedItem = context.repository.items.save({ language: "en", cue: "Cached", target: "Already cached." });
    const missingItem = context.repository.items.save({ language: "en", cue: "Missing", target: "Generate me first." });
    const cachedSpeech = vi.fn((input: { text: string }) => input.text === cachedItem.target
      ? { audio: Buffer.from([1]), format: "mp3" } : null);
    const speech = vi.fn().mockResolvedValue({ audio: Buffer.from([2]), format: "mp3", cached: false });
    const compatibleVoiceId = vi.fn().mockImplementation(async (_language, voiceId) => voiceId);
    const app = await buildApp(context.repository, {
      elevenlabs: { cachedSpeech, compatibleVoiceId, speech } as unknown as ElevenLabsService,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/audio/prepare",
      payload: {
        itemIds: [cachedItem.publicId, missingItem.publicId],
        priorityItemId: missingItem.publicId,
        language: "en",
        provider: "elevenlabs",
        voiceId: "voice-id",
        modelId: "eleven_multilingual_v2",
        speed: 1,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ total: 2, ready: 1, initialCached: 1 });
    expect(response.json().items[0].itemId).toBe(missingItem.publicId);
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ text: missingItem.target, voiceId: "voice-id" }));
    const status = await app.inject({ method: "GET", url: `/api/audio/prepare/${response.json().jobId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ total: 2, ready: 2, status: "ready" });
    await app.close();
  });

  it("rejects a preparation priority outside the requested stack", async () => {
    const item = context.repository.items.save({ language: "en", cue: "Cue", target: "Card." });
    const app = await buildApp(context.repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/audio/prepare",
      payload: {
        itemIds: [item.publicId],
        priorityItemId: "outside-stack",
        language: "en",
        provider: "openai",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "AUDIO_PRIORITY_ITEM_NOT_FOUND" });
    await app.close();
  });

  it("requires ElevenLabs Flash v2.5 for Vietnamese", async () => {
    context.repository.system.setLanguageEnabled("vi", true);
    const speech = vi.fn().mockResolvedValue({ audio: Buffer.from([1]), cached: false });
    const compatibleVoiceId = vi.fn().mockImplementation(async (_language, voiceId) => voiceId);
    const app = await buildApp(context.repository, {
      elevenlabs: { compatibleVoiceId, speech } as unknown as ElevenLabsService,
    });
    const unsupportedProvider = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Xin chào", language: "vi", provider: "openai" },
    });
    const unsupportedModel = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Xin chào", language: "vi", provider: "elevenlabs", modelId: "eleven_multilingual_v2" },
    });
    const supported = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Xin chào", language: "vi", provider: "elevenlabs", modelId: "eleven_flash_v2_5", voiceId: "vi-voice" },
    });

    expect(unsupportedProvider.json().error).toBe("VIETNAMESE_ELEVENLABS_REQUIRED");
    expect(unsupportedModel.json().error).toBe("VIETNAMESE_MODEL_UNSUPPORTED");
    expect(supported.statusCode).toBe(200);
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ language: "vi", modelId: "eleven_flash_v2_5" }));
    await app.close();
  });

  it("requires a compatible ElevenLabs Flash voice for Norwegian", async () => {
    const speech = vi.fn().mockResolvedValue({ audio: Buffer.from([1]), cached: false });
    const compatibleVoiceId = vi.fn().mockImplementation(async (_language, voiceId) => voiceId);
    const app = await buildApp(context.repository, {
      elevenlabs: { compatibleVoiceId, speech } as unknown as ElevenLabsService,
    });
    const unsupportedProvider = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "God morgen", language: "no", provider: "openai" },
    });
    const supported = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "God morgen", language: "no", provider: "elevenlabs", modelId: "eleven_flash_v2_5", voiceId: "no-voice" },
    });

    expect(unsupportedProvider.json().error).toBe("NORWEGIAN_ELEVENLABS_REQUIRED");
    expect(supported.statusCode).toBe(200);
    expect(compatibleVoiceId).toHaveBeenCalledWith("no", "no-voice");
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ language: "no", voiceId: "no-voice" }));
    await app.close();
  });

  it("requires a compatible ElevenLabs Flash voice for Bahasa Indonesia", async () => {
    context.repository.system.setLanguageEnabled("id", true);
    const speech = vi.fn().mockResolvedValue({ audio: Buffer.from([1]), cached: false });
    const compatibleVoiceId = vi.fn().mockImplementation(async (_language, voiceId) => voiceId);
    const app = await buildApp(context.repository, {
      elevenlabs: { compatibleVoiceId, speech } as unknown as ElevenLabsService,
    });
    const unsupportedProvider = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Selamat pagi", language: "id", provider: "openai" },
    });
    const unsupportedModel = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Selamat pagi", language: "id", provider: "elevenlabs", modelId: "eleven_multilingual_v2" },
    });
    const supported = await app.inject({
      method: "POST", url: "/api/audio/speech",
      payload: { text: "Selamat pagi", language: "id", provider: "elevenlabs", modelId: "eleven_flash_v2_5", voiceId: "id-voice" },
    });

    expect(unsupportedProvider.json().error).toBe("INDONESIAN_ELEVENLABS_REQUIRED");
    expect(unsupportedModel.json().error).toBe("INDONESIAN_MODEL_UNSUPPORTED");
    expect(supported.statusCode).toBe(200);
    expect(compatibleVoiceId).toHaveBeenCalledWith("id", "id-voice");
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ language: "id", voiceId: "id-voice" }));
    await app.close();
  });
});
