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
    expect(JSON.parse(String(options.body))).not.toHaveProperty("language_code");
  });

  it("coalesces concurrent identical requests into one paid generation", async () => {
    let resolveRequest!: (response: Response) => void;
    const request = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", request);
    const service = new ElevenLabsService(repository, "test-key");
    const input = { text: "One paid request.", language: "en" as const, speed: 1 };

    const firstRequest = service.speech(input);
    const concurrentRequest = service.speech(input);
    expect(request).toHaveBeenCalledTimes(1);
    resolveRequest(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));

    const [first, concurrent] = await Promise.all([firstRequest, concurrentRequest]);
    expect(first.cached).toBe(false);
    expect(concurrent.cached).toBe(true);
    expect(concurrent.audio).toEqual(first.audio);
  });

  it("reuses cached audio after the database is reopened", async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([7, 8, 9]), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const input = { text: "Persistent cache.", language: "en" as const };
    await new ElevenLabsService(repository, "test-key").speech(input);

    db.close();
    db = openDatabase(path.join(tempDir, "test.sqlite"));
    repository = new RehearsalRepository(db);
    const cached = await new ElevenLabsService(repository, "test-key").speech(input);

    expect(cached.cached).toBe(true);
    expect(cached.audio).toEqual(Buffer.from([7, 8, 9]));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("checks and caches configured voice metadata without exposing the key", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      voice_id: "voice-id",
      name: "Christopher - Tender, Kind and Steady",
      category: "professional",
      description: "Kind, casual conversation.",
      labels: { accent: "american", use_case: "conversational" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    const service = new ElevenLabsService(repository, "test-key");

    const first = await service.voiceStatus();
    const second = await service.voiceStatus();

    expect(first).toMatchObject({
      configured: true,
      reachable: true,
      voice: { name: "Christopher - Tender, Kind and Steady", category: "professional" },
    });
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0][1] as RequestInit;
    expect(options.headers).toMatchObject({ "xi-api-key": "test-key" });
  });

  it("lists and caches every saved ElevenLabs voice across pages", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        voices: [{ voice_id: "voice-b", name: "Beta" }],
        has_more: true,
        next_page_token: "next-page",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        voices: [{ voice_id: "voice-a", name: "Alpha" }],
        has_more: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    const service = new ElevenLabsService(repository, "test-key");

    const first = await service.listVoices();
    const second = await service.listVoices();

    expect(first).toEqual([
      { id: "voice-b", name: "Beta" },
      { id: "voice-a", name: "Alpha" },
    ]);
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(request.mock.calls[0][0]));
    const secondUrl = new URL(String(request.mock.calls[1][0]));
    expect(firstUrl.searchParams.get("voice_type")).toBe("saved");
    expect(firstUrl.searchParams.get("page_size")).toBe("100");
    expect(secondUrl.searchParams.get("next_page_token")).toBe("next-page");
  });

  it("falls back to built-in voices when ElevenLabs cannot list My Voices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    const service = new ElevenLabsService(repository, "test-key");

    await expect(service.listVoices()).resolves.toContainEqual({
      id: "ueSxRO0nLF1bj93J2hVt",
      name: "Trung Caha",
    });
  });

  it("clamps ElevenLabs speed to its documented API range", async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const service = new ElevenLabsService(repository, "test-key");

    await service.speech({ text: "Not too fast.", language: "en", speed: 1.5 });

    const options = request.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body)).voice_settings.speed).toBe(1.2);
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
