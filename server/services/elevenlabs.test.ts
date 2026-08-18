import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import { ElevenLabsError, ElevenLabsService } from "./elevenlabs.js";

describe("ElevenLabsService", () => {
  let tempDir: string;
  let db: RehearsalDatabase;
  let repository: RehearsalRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-elevenlabs-test-"));
    db = openDatabase(path.join(tempDir, "test.sqlite"));
    repository = new RehearsalRepository(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("sends voice tuning and caches generated audio", async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const service = new ElevenLabsService(repository, "test-key");
    const input = {
      text: "This is a test.",
      language: "en" as const,
      voiceId: "voice-id",
      modelId: "eleven_multilingual_v2" as const,
      stability: 0.45,
      similarityBoost: 0.6,
      style: 0.02,
      speakerBoost: true,
      speed: 1.05,
    };

    const first = await service.speech(input);
    const second = await service.speech(input);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toMatchObject({
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.6,
        style: 0.02,
        use_speaker_boost: true,
        speed: 1.05,
      },
    });
  });

  it("preserves ElevenLabs plan errors for the API response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "paid_plan_required", message: "Paid plan required" },
    }), { status: 402, headers: { "Content-Type": "application/json" } })));
    const service = new ElevenLabsService(repository, "test-key");

    await expect(service.speech({ text: "Test", language: "en" }))
      .rejects.toEqual(expect.objectContaining<Partial<ElevenLabsError>>({
        statusCode: 402,
        code: "paid_plan_required",
      }));
  });
});
