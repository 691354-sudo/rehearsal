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
      speedRange: { min: 0.7, max: 1.2 },
    });
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
    const response = await app.inject({ method: "GET", url: "/api/audio/elevenlabs/status?refresh=true" });
    expect(response.json()).toMatchObject({ reachable: true, voice: { name: "Verified voice" } });
    expect(voiceStatus).toHaveBeenCalledWith(true);
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
});
