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

export type ElevenLabsVoiceStatus = {
  configured: boolean;
  reachable: boolean;
  checkedAt: string;
  voice: {
    id: string;
    name: string;
    category: string;
    description: string;
    labels: Record<string, string>;
  };
  error: string;
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

export const elevenLabsSpeedRange = { min: 0.7, max: 1.2 } as const;

const voiceStatusTtlMs = 10 * 60 * 1_000;

const readElevenLabsError = async (response: Response) => {
  const payload = await response.json().catch(() => null) as {
    detail?: string | { code?: string; message?: string; status?: string };
  } | null;
  const detail = payload?.detail;
  return {
    code: typeof detail === "object" ? (detail.code || detail.status) : undefined,
    message: typeof detail === "object" ? detail.message : detail,
  };
};

export class ElevenLabsService {
  private readonly inflightSpeech = new Map<string, Promise<{ format: string; audio: Buffer }>>();
  private voiceStatusCache: ElevenLabsVoiceStatus | null = null;
  private voiceStatusRequest: Promise<ElevenLabsVoiceStatus> | null = null;

  constructor(
    private readonly repository: RehearsalRepository,
    private readonly apiKey = config.elevenLabsApiKey,
  ) {}

  get configured() {
    return Boolean(this.apiKey);
  }

  async voiceStatus(refresh = false): Promise<ElevenLabsVoiceStatus> {
    const fallbackVoice = {
      id: config.elevenLabsVoiceId,
      name: config.elevenLabsVoiceName,
      category: "",
      description: "",
      labels: {},
    };
    const checkedAt = new Date().toISOString();
    if (!this.configured) {
      return { configured: false, reachable: false, checkedAt, voice: fallbackVoice, error: "API key missing" };
    }
    if (!refresh && this.voiceStatusCache
      && Date.now() - Date.parse(this.voiceStatusCache.checkedAt) < voiceStatusTtlMs) {
      return this.voiceStatusCache;
    }
    if (!refresh && this.voiceStatusRequest) return this.voiceStatusRequest;

    const request = this.fetchVoiceStatus(fallbackVoice).then((status) => {
      this.voiceStatusCache = status;
      return status;
    }).finally(() => {
      this.voiceStatusRequest = null;
    });
    this.voiceStatusRequest = request;
    return request;
  }

  async speech(input: ElevenLabsSpeechInput) {
    if (!this.configured) throw new Error("ELEVENLABS_NOT_CONFIGURED");

    const voiceId = input.voiceId || config.elevenLabsVoiceId;
    const modelId = input.modelId || config.elevenLabsModel as NonNullable<ElevenLabsSpeechInput["modelId"]>;
    const text = input.text.trim().normalize("NFC");
    const settings = {
      stability: clamp(input.stability, config.elevenLabsStability, 0, 1),
      similarity_boost: clamp(input.similarityBoost, config.elevenLabsSimilarityBoost, 0, 1),
      style: clamp(input.style, config.elevenLabsStyle, 0, 1),
      use_speaker_boost: input.speakerBoost ?? config.elevenLabsSpeakerBoost,
      speed: clamp(input.speed, config.elevenLabsSpeed, elevenLabsSpeedRange.min, elevenLabsSpeedRange.max),
    };
    const cacheKey = createHash("sha256")
      .update(["elevenlabs", modelId, voiceId, JSON.stringify(settings), input.language, text].join("\0"))
      .digest("hex");
    const cached = this.repository.getCachedAudio(cacheKey);
    if (cached) return { ...cached, cached: true };

    const pending = this.inflightSpeech.get(cacheKey);
    if (pending) return { ...await pending, cached: true };

    const generation = this.generateSpeech({ text, language: input.language, voiceId, modelId, settings, cacheKey })
      .finally(() => this.inflightSpeech.delete(cacheKey));
    this.inflightSpeech.set(cacheKey, generation);
    return { ...await generation, cached: false };
  }

  private async fetchVoiceStatus(fallbackVoice: ElevenLabsVoiceStatus["voice"]): Promise<ElevenLabsVoiceStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(fallbackVoice.id)}`,
        { headers: { Accept: "application/json", "xi-api-key": this.apiKey } },
      );
      if (!response.ok) {
        const detail = await readElevenLabsError(response);
        return {
          configured: true,
          reachable: false,
          checkedAt,
          voice: fallbackVoice,
          error: detail.message || `ElevenLabs returned ${response.status}`,
        };
      }
      const payload = await response.json() as {
        voice_id?: string;
        name?: string;
        category?: string;
        description?: string | null;
        labels?: Record<string, string>;
      };
      return {
        configured: true,
        reachable: true,
        checkedAt,
        voice: {
          id: payload.voice_id || fallbackVoice.id,
          name: payload.name || fallbackVoice.name,
          category: payload.category || "",
          description: payload.description || "",
          labels: payload.labels || {},
        },
        error: "",
      };
    } catch {
      return {
        configured: true,
        reachable: false,
        checkedAt,
        voice: fallbackVoice,
        error: "ElevenLabs could not be reached",
      };
    }
  }

  private async generateSpeech(input: {
    text: string;
    language: LanguageCode | "ru";
    voiceId: string;
    modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
    settings: {
      stability: number;
      similarity_boost: number;
      style: number;
      use_speaker_boost: boolean;
      speed: number;
    };
    cacheKey: string;
  }) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          ...(input.modelId === "eleven_flash_v2_5" ? { language_code: input.language } : {}),
          voice_settings: input.settings,
        }),
      },
    );

    if (!response.ok) {
      const detail = await readElevenLabsError(response);
      throw new ElevenLabsError(
        detail.message || `ElevenLabs returned ${response.status}`,
        response.status,
        detail.code || "ELEVENLABS_REQUEST_FAILED",
      );
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new ElevenLabsError("ElevenLabs returned empty audio", 502, "ELEVENLABS_EMPTY_AUDIO");
    this.repository.saveCachedAudio({
      cacheKey: input.cacheKey,
      model: input.modelId,
      voice: input.voiceId,
      format: "mp3",
      audio,
    });
    return { format: "mp3", audio };
  }
}
