import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode, SaturationSettings, SaturationSnapshotItem, SaturationTrack } from "../types.js";
import type { ElevenLabsService } from "./elevenlabs.js";
import type { OpenAIService } from "./openai.js";

const runFile = promisify(execFile);

const quoteConcatPath = (value: string) => value.replaceAll("'", "'\\''");

const runFfmpeg = async (binary: string, args: string[]) => {
  try {
    await runFile(binary, args, { maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(`FFMPEG_FAILED: ${detail.stderr?.trim() || detail.message}`);
  }
};

export async function combineSaturationMp3(input: {
  phraseAudio: Buffer[];
  sequence: number[];
  pauseSeconds: number;
  ffmpegPath?: string;
}) {
  const ffmpegPath = input.ffmpegPath || config.ffmpegPath;
  const tempDir = await mkdtemp(join(tmpdir(), "rehearsal-saturation-"));
  try {
    const normalizedPaths: string[] = [];
    for (let index = 0; index < input.phraseAudio.length; index += 1) {
      const sourcePath = join(tempDir, `source-${index}.mp3`);
      const normalizedPath = join(tempDir, `phrase-${index}.mp3`);
      await writeFile(sourcePath, input.phraseAudio[index]);
      await runFfmpeg(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", sourcePath,
        "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", normalizedPath,
      ]);
      normalizedPaths.push(normalizedPath);
    }

    const silencePath = join(tempDir, "silence.mp3");
    await runFfmpeg(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "anullsrc=r=44100:cl=mono", "-t", String(input.pauseSeconds),
      "-c:a", "libmp3lame", "-b:a", "128k", silencePath,
    ]);

    const concatPath = join(tempDir, "sequence.txt");
    const sequenceLines: string[] = [];
    input.sequence.forEach((phraseIndex, sequenceIndex) => {
      sequenceLines.push(`file '${quoteConcatPath(normalizedPaths[phraseIndex])}'`);
      if (sequenceIndex < input.sequence.length - 1) sequenceLines.push(`file '${quoteConcatPath(silencePath)}'`);
    });
    await writeFile(concatPath, `${sequenceLines.join("\n")}\n`, "utf8");

    const outputPath = join(tempDir, "track.mp3");
    await runFfmpeg(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
      "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", outputPath,
    ]);

    const ffprobePath = ffmpegPath.includes("/") ? join(dirname(ffmpegPath), "ffprobe") : "ffprobe";
    const { stdout } = await runFile(ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
    ]);
    const durationSeconds = Number(stdout.trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("FFPROBE_INVALID_DURATION");
    return { audio: await readFile(outputPath), durationSeconds };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const makeConfigHash = (input: {
  language: LanguageCode;
  islandId: string;
  snapshot: SaturationSnapshotItem[];
  settings: SaturationSettings;
}) => createHash("sha256").update(JSON.stringify({
  language: input.language,
  islandId: input.islandId,
  snapshot: input.snapshot.map(({ publicId, target }) => [publicId, target]),
  settings: input.settings,
})).digest("hex");

export class SaturationService {
  private readonly builds = new Set<string>();

  constructor(
    private readonly repository: RehearsalRepository,
    private readonly openai: OpenAIService,
    private readonly elevenlabs: ElevenLabsService,
  ) {
    this.repository.recoverInterruptedSaturationTracks();
  }

  requestTrack(input: {
    language: LanguageCode;
    islandId: string;
    settings: SaturationSettings;
  }) {
    const topic = this.repository.listSaturationTopics(input.language)
      .find((candidate) => candidate.islandId === input.islandId);
    const snapshot = this.repository.getSaturationTopicItems(input.language, input.islandId);
    if (!topic || !snapshot.length) throw new Error("SATURATION_TOPIC_NOT_FOUND");
    const configHash = makeConfigHash({ ...input, snapshot });
    const cacheKey = `saturation:${configHash}`;
    const result = this.repository.createOrRetrySaturationTrack({
      configHash,
      language: input.language,
      islandId: topic.islandId,
      topicTitle: topic.title,
      snapshot,
      settings: input.settings,
      cacheKey,
    });
    if (result.shouldBuild) void this.build(result.track);
    return result.track;
  }

  getTrack(publicId: string) {
    return this.repository.getSaturationTrack(publicId);
  }

  getTrackAudio(publicId: string) {
    const track = this.repository.getSaturationTrack(publicId);
    if (!track || track.status !== "ready") return null;
    return this.repository.getCachedAudio(track.cacheKey)?.audio || null;
  }

  private async build(track: SaturationTrack) {
    if (this.builds.has(track.publicId)) return;
    this.builds.add(track.publicId);
    try {
      const phraseAudio: Buffer[] = [];
      for (const item of track.snapshot) {
        const generated = track.settings.provider === "elevenlabs"
          ? await this.elevenlabs.speech({
            text: item.target,
            language: track.language,
            voiceId: track.settings.voice,
            modelId: track.settings.modelId,
            stability: track.settings.stability,
            similarityBoost: track.settings.similarityBoost,
            style: track.settings.style,
            speakerBoost: track.settings.speakerBoost,
            speed: track.settings.speed,
          })
          : await this.openai.speech({
            text: item.target,
            language: track.language,
            voice: track.settings.voice,
            speed: track.settings.speed,
          });
        phraseAudio.push(generated.audio);
      }
      const sequence = track.snapshot.flatMap((_item, itemIndex) =>
        Array.from({ length: track.settings.repetitions }, () => itemIndex));
      const built = await combineSaturationMp3({
        phraseAudio,
        sequence,
        pauseSeconds: track.settings.pauseSeconds,
      });
      this.repository.saveCachedAudio({
        cacheKey: track.cacheKey,
        model: "saturation-v1",
        voice: track.settings.voice,
        format: "mp3",
        audio: built.audio,
      });
      this.repository.completeSaturationTrack(track.publicId, built.durationSeconds);
    } catch (error) {
      this.repository.failSaturationTrack(track.publicId, error instanceof Error ? error.message : "SATURATION_BUILD_FAILED");
    } finally {
      this.builds.delete(track.publicId);
    }
  }
}
