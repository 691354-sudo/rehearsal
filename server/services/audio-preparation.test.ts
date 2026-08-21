import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import { AudioPreparationService } from "./audio-preparation.js";
import { ElevenLabsService } from "./elevenlabs.js";
import type { OpenAIService } from "./openai.js";

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not met");
};

describe("AudioPreparationService", () => {
  let tempDir: string;
  let db: RehearsalDatabase;
  let repository: RehearsalRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-audio-prepare-test-"));
    db = openDatabase(path.join(tempDir, "test.sqlite"));
    repository = new RehearsalRepository(db);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("prioritizes the first card and limits background generation to three", async () => {
    const items = Array.from({ length: 6 }, (_, index) => repository.items.save({
      language: "en", cue: `Cue ${index}`, target: `Card ${index}`,
    }));
    let active = 0;
    let maximumActive = 0;
    const speech = vi.fn(async (_input: { text: string }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { audio: Buffer.from([1]), format: "mp3", cached: false };
    });
    const openai = { cachedSpeech: () => null, speech } as unknown as OpenAIService;
    const service = new AudioPreparationService(
      repository,
      openai,
      { cachedSpeech: () => null, speech } as unknown as ElevenLabsService,
    );

    const job = service.prepare(items.map((item) => item.publicId), {
      language: "en", provider: "openai", voice: "onyx", speed: 1,
    }, items[4].publicId);
    await waitFor(() => service.get(job.jobId)?.status === "ready");

    expect(speech.mock.calls[0][0]).toMatchObject({ text: "Card 4" });
    expect(maximumActive).toBe(3);
    expect(speech).toHaveBeenCalledTimes(6);
  });

  it("cancels pending work but keeps in-flight results", async () => {
    const items = Array.from({ length: 5 }, (_, index) => repository.items.save({
      language: "en", cue: `Cue ${index}`, target: `Card ${index}`,
    }));
    const releases: Array<() => void> = [];
    const speech = vi.fn(() => new Promise<{ audio: Buffer; format: string; cached: boolean }>((resolve) => {
      releases.push(() => resolve({ audio: Buffer.from([1]), format: "mp3", cached: false }));
    }));
    const openai = { cachedSpeech: () => null, speech } as unknown as OpenAIService;
    const service = new AudioPreparationService(
      repository,
      openai,
      { cachedSpeech: () => null, speech } as unknown as ElevenLabsService,
    );

    const created = service.prepare(items.map((item) => item.publicId), { language: "en", provider: "openai" });
    await waitFor(() => speech.mock.calls.length === 3);
    const cancelled = service.cancel(created.jobId)!;
    expect(cancelled.items.filter((item) => item.status === "cancelled")).toHaveLength(2);
    releases.forEach((release) => release());
    await waitFor(() => service.get(created.jobId)?.ready === 3);
    expect(speech).toHaveBeenCalledTimes(3);
  });

  it("coalesces foreground playback with the same background ElevenLabs generation", async () => {
    const item = repository.items.save({ language: "en", cue: "Cue", target: "One paid request." });
    let release!: (response: Response) => void;
    const request = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal("fetch", request);
    const elevenlabs = new ElevenLabsService(repository, "test-key");
    const openai = { cachedSpeech: () => null } as unknown as OpenAIService;
    const service = new AudioPreparationService(repository, openai, elevenlabs);
    const settings = {
      language: "en" as const,
      provider: "elevenlabs" as const,
      voiceId: "voice-id",
      modelId: "eleven_multilingual_v2" as const,
      speed: 1,
    };

    const job = service.prepare([item.publicId], settings, item.publicId);
    await waitFor(() => request.mock.calls.length === 1);
    const foreground = elevenlabs.speech({ text: item.target, ...settings });
    expect(request).toHaveBeenCalledTimes(1);
    release(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    await foreground;
    await waitFor(() => service.get(job.jobId)?.status === "ready");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
