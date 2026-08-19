import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import { seedDatabase } from "../db/seed.js";
import type { ElevenLabsService } from "./elevenlabs.js";
import type { OpenAIService } from "./openai.js";
import { combineSaturationMp3, SaturationService } from "./saturation.js";

const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const makeTone = (directory: string, frequency: number, duration = 0.25) => {
  const output = path.join(directory, `tone-${frequency}.mp3`);
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:duration=${duration}`,
    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", output,
  ]);
  return fs.readFileSync(output);
};

const dominantFrequencies = (audio: Buffer, directory: string) => {
  const source = path.join(directory, "decoded-source.mp3");
  fs.writeFileSync(source, audio);
  const pcm = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", source,
    "-f", "f32le", "-ac", "1", "-ar", "8000", "pipe:1",
  ]);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const windowSize = 400;
  const windows: Array<{ active: boolean; frequency: number }> = [];
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let power = 0; let crossings = 0;
    for (let index = start; index < start + windowSize; index += 1) {
      power += samples[index] ** 2;
      if (index > start && Math.sign(samples[index]) !== Math.sign(samples[index - 1])) crossings += 1;
    }
    const rms = Math.sqrt(power / windowSize);
    windows.push({ active: rms > 0.025, frequency: crossings * 8000 / (2 * windowSize) });
  }
  const groups: number[][] = [];
  for (const window of windows) {
    if (!window.active) continue;
    if (!groups.length || groups[groups.length - 1].at(-1) === -1) groups.push([]);
    groups[groups.length - 1].push(window.frequency);
    const next = windows[windows.indexOf(window) + 1];
    if (!next?.active) groups[groups.length - 1].push(-1);
  }
  return groups.map((group) => {
    const values = group.filter((value) => value > 0).sort((left, right) => left - right);
    return values[Math.floor(values.length / 2)];
  });
};

describe.runIf(ffmpegAvailable)("SaturationService", () => {
  let tempDir: string;
  let db: RehearsalDatabase;
  let repository: RehearsalRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-saturation-test-"));
    db = openDatabase(path.join(tempDir, "test.sqlite"));
    repository = new RehearsalRepository(db);
    seedDatabase(repository);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("combines phrases in repeat order with accurate pauses", async () => {
    const result = await combineSaturationMp3({
      phraseAudio: [makeTone(tempDir, 440), makeTone(tempDir, 880)],
      sequence: [0, 0, 1, 1],
      pauseSeconds: 0.35,
      ffmpegPath: "ffmpeg",
    });
    expect(result.durationSeconds).toBeCloseTo(2.05, 0);
    const frequencies = dominantFrequencies(result.audio, tempDir);
    expect(frequencies).toHaveLength(4);
    expect(frequencies[0]).toBeGreaterThan(400); expect(frequencies[0]).toBeLessThan(480);
    expect(frequencies[1]).toBeGreaterThan(400); expect(frequencies[1]).toBeLessThan(480);
    expect(frequencies[2]).toBeGreaterThan(820); expect(frequencies[2]).toBeLessThan(940);
    expect(frequencies[3]).toBeGreaterThan(820); expect(frequencies[3]).toBeLessThan(940);
  });

  it("reuses a config hash, retries failures, and recovers interrupted builds", async () => {
    repository.saveItem({ language: "en", cue: "Один", target: "One.", tags: ["Walking test"] });
    repository.saveItem({ language: "en", cue: "Два", target: "Two.", tags: ["Walking test"] });
    repository.backfillTopicsFromTags("en");
    const walkingTopic = repository.findIslandByTitle("en", "Walking test")!;
    const tones = new Map([["One.", makeTone(tempDir, 440)], ["Two.", makeTone(tempDir, 880)]]);
    const speech = vi.fn(async ({ text }: { text: string }) => ({ audio: tones.get(text)!, format: "mp3", cached: false }));
    const openai = { speech } as unknown as OpenAIService;
    const elevenlabs = { speech: vi.fn() } as unknown as ElevenLabsService;
    const service = new SaturationService(repository, openai, elevenlabs);
    const request = {
      language: "en" as const,
      islandId: walkingTopic.publicId,
      settings: { provider: "openai" as const, voice: "marin", speed: 1, pauseSeconds: 0.5, repetitions: 2 },
    };

    const building = service.requestTrack(request);
    await vi.waitFor(() => expect(service.getTrack(building.publicId)?.status).toBe("ready"), { timeout: 10_000 });
    const reused = service.requestTrack(request);
    expect(reused.publicId).toBe(building.publicId);
    expect(speech).toHaveBeenCalledTimes(2);

    repository.updateIsland(walkingTopic.publicId, {
      itemPublicIds: repository.getIsland(walkingTopic.publicId)!.items.map((item) => item.publicId).reverse(),
    });
    const reordered = service.requestTrack(request);
    expect(reordered.publicId).not.toBe(building.publicId);
    expect(reordered.configHash).not.toBe(building.configHash);
    await vi.waitFor(() => expect(service.getTrack(reordered.publicId)?.status).toBe("ready"), { timeout: 10_000 });

    repository.saveItem({ language: "en", cue: "Ошибка", target: "Retry me.", tags: ["Retry topic"] });
    repository.backfillTopicsFromTags("en");
    const retryTopic = repository.findIslandByTitle("en", "Retry topic")!;
    const retrySpeech = vi.fn()
      .mockRejectedValueOnce(new Error("TTS_DOWN"))
      .mockResolvedValue({ audio: makeTone(tempDir, 660), format: "mp3", cached: false });
    const retryService = new SaturationService(repository, { speech: retrySpeech } as unknown as OpenAIService, elevenlabs);
    const retryRequest = { ...request, islandId: retryTopic.publicId, settings: { ...request.settings, repetitions: 1 } };
    const failed = retryService.requestTrack(retryRequest);
    await vi.waitFor(() => expect(retryService.getTrack(failed.publicId)?.status).toBe("failed"));
    expect(retryService.requestTrack(retryRequest).publicId).toBe(failed.publicId);
    await vi.waitFor(() => expect(retryService.getTrack(failed.publicId)?.status).toBe("ready"), { timeout: 10_000 });

    const interrupted = repository.createOrRetrySaturationTrack({
      configHash: "a".repeat(64), language: "en", islandId: retryTopic.publicId, topicTitle: "Interrupted",
      snapshot: [{ publicId: "missing", target: "Missing" }], settings: request.settings, cacheKey: "saturation:interrupted",
    }).track;
    expect(interrupted.status).toBe("building");
    new SaturationService(repository, openai, elevenlabs);
    expect(repository.getSaturationTrack(interrupted.publicId)).toMatchObject({ status: "failed", error: "BUILD_INTERRUPTED" });
  }, 20_000);
});
