import { createHash } from "node:crypto";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode } from "../types.js";

export type ElevenLabsSpeechInput = {
  text: string;
  language: LanguageCode | "ru";
  voiceId?: string;
  modelId?: "eleven_multilingual_v2" | "eleven_flash_v2_5";
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
  speed?: number;
};

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value ?? fallback));

export class ElevenLabsService {
  constructor(
    private readonly repository: RehearsalRepository,
    private readonly apiKey = config.elevenLabsApiKey,
  ) {}

  get configured() {
    return Boolean(this.apiKey);
  }

  async speech(input: ElevenLabsSpeechInput) {
    if (!this.configured) throw new Error("ELEVENLABS_NOT_CONFIGURED");

    const voiceId = input.voiceId || config.elevenLabsVoiceId;
    const modelId = input.modelId || config.elevenLabsModel;
    const settings = {
      stability: clamp(input.stability, config.elevenLabsStability, 0, 1),
      similarity_boost: clamp(input.similarityBoost, config.elevenLabsSimilarityBoost, 0, 1),
      style: clamp(input.style, config.elevenLabsStyle, 0, 1),
      use_speaker_boost: input.speakerBoost ?? config.elevenLabsSpeakerBoost,
      speed: clamp(input.speed, config.elevenLabsSpeed, 0.5, 1.5),
    };
    const cacheKey = createHash("sha256")
      .update(["elevenlabs", modelId, voiceId, JSON.stringify(settings), input.language, input.text].join("\0"))
      .digest("hex");
    const cached = this.repository.getCachedAudio(cacheKey);
    if (cached) return { ...cached, cached: true };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text: input.text,
          model_id: modelId,
          language_code: input.language,
          voice_settings: settings,
        }),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {
        detail?: { code?: string; message?: string };
      } | null;
      const code = payload?.detail?.code || "ELEVENLABS_REQUEST_FAILED";
      throw new ElevenLabsError(payload?.detail?.message || `ElevenLabs returned ${response.status}`, response.status, code);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    this.repository.saveCachedAudio({ cacheKey, model: modelId, voice: voiceId, format: "mp3", audio });
    return { format: "mp3", audio, cached: false };
  }
}
