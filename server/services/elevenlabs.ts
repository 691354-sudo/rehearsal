import { createHash } from "node:crypto";
import { config, elevenLabsVoices } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode } from "../types.js";

export type ElevenLabsSpeechInput = {
  text: string;
  language: LanguageCode | "ru";
  voiceId?: string;
  modelId?: "eleven_multilingual_v2" | "eleven_flash_v2_5";
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
type AudioRepositories = Pick<RehearsalRepository, "audio">;

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
export const elevenLabsVoiceSettings = {
  stability: 1,
  similarity_boost: 1,
  style: 0.02,
  use_speaker_boost: true,
} as const;

const voiceStatusTtlMs = 10 * 60 * 1_000;
const voiceListTtlMs = 10 * 60 * 1_000;

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
  private voiceListCache: { fetchedAt: number; voices: { id: string; name: string }[] } | null = null;
  private voiceListRequest: Promise<{ id: string; name: string }[]> | null = null;
  private readonly voiceStatusCache = new Map<string, ElevenLabsVoiceStatus>();
  private readonly voiceStatusRequests = new Map<string, Promise<ElevenLabsVoiceStatus>>();

  constructor(
    private readonly repository: AudioRepositories,
    private readonly apiKey = config.elevenLabsApiKey,
  ) {}

  get configured() {
    return Boolean(this.apiKey);
  }

  async listVoices(refresh = false) {
    if (!this.configured) return elevenLabsVoices;
    if (!refresh && this.voiceListCache
      && Date.now() - this.voiceListCache.fetchedAt < voiceListTtlMs) {
      return this.voiceListCache.voices;
    }
    if (!refresh && this.voiceListRequest) return this.voiceListRequest;

    const request = this.fetchVoices().then((voices) => {
      if (!voices.length) return elevenLabsVoices;
      this.voiceListCache = { fetchedAt: Date.now(), voices };
      return voices;
    }).catch(() => elevenLabsVoices).finally(() => {
      this.voiceListRequest = null;
    });
    this.voiceListRequest = request;
    return request;
  }

  async voiceStatus(refresh = false, voiceId = config.elevenLabsVoiceId): Promise<ElevenLabsVoiceStatus> {
    const configuredVoice = elevenLabsVoices.find((voice) => voice.id === voiceId);
    const fallbackVoice = {
      id: voiceId,
      name: configuredVoice?.name || voiceId,
      category: "",
      description: "",
      labels: {},
    };
    const checkedAt = new Date().toISOString();
    if (!this.configured) {
      return { configured: false, reachable: false, checkedAt, voice: fallbackVoice, error: "API key missing" };
    }
    const cached = this.voiceStatusCache.get(voiceId);
    if (!refresh && cached
      && Date.now() - Date.parse(cached.checkedAt) < voiceStatusTtlMs) {
      return cached;
    }
    const pending = this.voiceStatusRequests.get(voiceId);
    if (!refresh && pending) return pending;

    const request = this.fetchVoiceStatus(fallbackVoice).then((status) => {
      this.voiceStatusCache.set(voiceId, status);
      return status;
    }).finally(() => {
      this.voiceStatusRequests.delete(voiceId);
    });
    this.voiceStatusRequests.set(voiceId, request);
    return request;
  }

  async speech(input: ElevenLabsSpeechInput) {
    if (!this.configured) throw new Error("ELEVENLABS_NOT_CONFIGURED");
    const resolved = this.resolveSpeech(input);
    const { voiceId, modelId, text, settings, cacheKey } = resolved;
    if (input.language === "vi" && modelId !== "eleven_flash_v2_5") {
      throw new ElevenLabsError(
        "Vietnamese playback requires Eleven Flash v2.5.",
        400,
        "VIETNAMESE_MODEL_UNSUPPORTED",
      );
    }
    const cached = this.repository.audio.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    const pending = this.inflightSpeech.get(cacheKey);
    if (pending) return { ...await pending, cached: true };

    const generation = this.generateSpeech({ text, language: input.language, voiceId, modelId, settings, cacheKey })
      .finally(() => this.inflightSpeech.delete(cacheKey));
    this.inflightSpeech.set(cacheKey, generation);
    return { ...await generation, cached: false };
  }

  cachedSpeech(input: ElevenLabsSpeechInput) {
    return this.repository.audio.get(this.resolveSpeech(input).cacheKey);
  }

  private resolveSpeech(input: ElevenLabsSpeechInput) {
    const voiceId = input.voiceId || (input.language === "vi"
      ? config.elevenLabsViVoiceId : config.elevenLabsVoiceId);
    const modelId = input.modelId || (input.language === "vi"
      ? "eleven_flash_v2_5"
      : config.elevenLabsModel as NonNullable<ElevenLabsSpeechInput["modelId"]>);
    const text = input.text.trim().normalize("NFC");
    const settings = {
      ...elevenLabsVoiceSettings,
      speed: clamp(input.speed, config.elevenLabsSpeed, elevenLabsSpeedRange.min, elevenLabsSpeedRange.max),
    };
    const cacheKey = createHash("sha256")
      .update(["elevenlabs", modelId, voiceId, JSON.stringify(settings), input.language, text].join("\0"))
      .digest("hex");
    return { voiceId, modelId, text, settings, cacheKey };
  }

  private async fetchVoices() {
    const voices: { id: string; name: string }[] = [];
    let nextPageToken = "";

    do {
      const query = new URLSearchParams({
        voice_type: "saved",
        page_size: "100",
        include_total_count: "false",
        sort: "name",
        sort_direction: "asc",
      });
      if (nextPageToken) query.set("next_page_token", nextPageToken);
      const response = await fetch(`https://api.elevenlabs.io/v2/voices?${query}`, {
        headers: { Accept: "application/json", "xi-api-key": this.apiKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
      const payload = await response.json() as {
        voices?: { voice_id?: string; name?: string }[];
        has_more?: boolean;
        next_page_token?: string | null;
      };
      for (const voice of payload.voices || []) {
        if (voice.voice_id && voice.name) voices.push({ id: voice.voice_id, name: voice.name });
      }
      if (!payload.has_more) break;
      if (!payload.next_page_token || payload.next_page_token === nextPageToken) {
        throw new Error("ElevenLabs voice pagination stopped unexpectedly");
      }
      nextPageToken = payload.next_page_token;
    } while (nextPageToken);

    return Array.from(new Map(voices.map((voice) => [voice.id, voice])).values());
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
    this.repository.audio.save({
      cacheKey: input.cacheKey,
      model: input.modelId,
      voice: input.voiceId,
      format: "mp3",
      audio,
    });
    return { format: "mp3", audio };
  }
}
