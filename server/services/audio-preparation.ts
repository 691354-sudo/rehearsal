import { randomUUID } from "node:crypto";
import type { LanguageCode } from "../types.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { ElevenLabsService, ElevenLabsSpeechInput } from "./elevenlabs.js";
import type { OpenAIService } from "./openai.js";

type PreparationStatus = "pending" | "preparing" | "ready" | "failed" | "cancelled";

export type AudioPreparationSettings = {
  language: LanguageCode;
  provider: "openai" | "elevenlabs";
  voice?: string;
  voiceId?: string;
  modelId?: ElevenLabsSpeechInput["modelId"];
  speed?: number;
};

type PreparationItem = {
  itemId: string;
  text: string;
  status: PreparationStatus;
  error: string;
};

type PreparationJob = {
  id: string;
  settings: AudioPreparationSettings;
  items: PreparationItem[];
  initialCached: number;
  cancelled: boolean;
  updatedAt: number;
};

const workerCount = 3;
const jobTtlMs = 60 * 60 * 1_000;

export class AudioPreparationService {
  private readonly jobs = new Map<string, PreparationJob>();
  private activeGenerations = 0;

  constructor(
    private readonly repository: RehearsalRepository,
    private readonly openai: OpenAIService,
    private readonly elevenlabs: ElevenLabsService,
  ) {}

  prepare(itemIds: string[], settings: AudioPreparationSettings, priorityItemId?: string) {
    this.pruneJobs();
    const orderedItemIds = priorityItemId
      ? [priorityItemId, ...itemIds.filter((itemId) => itemId !== priorityItemId)] : itemIds;
    const items = orderedItemIds.map((itemId) => {
      const item = this.repository.items.get(itemId);
      if (!item) throw new AudioPreparationError("AUDIO_ITEM_NOT_FOUND", 404);
      if (item.language !== settings.language) {
        throw new AudioPreparationError("AUDIO_ITEM_LANGUAGE_MISMATCH", 409);
      }
      const cached = this.cached(item.target, settings);
      return { itemId, text: item.target, status: cached ? "ready" : "pending", error: "" } satisfies PreparationItem;
    });
    const job: PreparationJob = {
      id: randomUUID(),
      settings,
      items,
      initialCached: items.filter((item) => item.status === "ready").length,
      cancelled: false,
      updatedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.pump();
    return this.snapshot(job);
  }

  get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? this.snapshot(job) : null;
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.cancelled = true;
    job.updatedAt = Date.now();
    for (const item of job.items) {
      if (item.status === "pending") item.status = "cancelled";
    }
    return this.snapshot(job);
  }

  private pump() {
    while (this.activeGenerations < workerCount) {
      const task = this.nextPending();
      if (!task) return;
      const { job, item } = task;
      item.status = "preparing";
      job.updatedAt = Date.now();
      this.activeGenerations += 1;
      void Promise.resolve().then(() => this.generate(item.text, job.settings)).then(() => {
        item.status = "ready";
      }).catch((error) => {
        item.status = "failed";
        item.error = error instanceof Error ? error.message.slice(0, 300) : "Audio preparation failed";
      }).finally(() => {
        job.updatedAt = Date.now();
        this.activeGenerations -= 1;
        this.pump();
      });
    }
  }

  private nextPending() {
    for (const job of this.jobs.values()) {
      if (job.cancelled) continue;
      const item = job.items.find((candidate) => candidate.status === "pending");
      if (item) return { job, item };
    }
    return null;
  }

  private cached(text: string, settings: AudioPreparationSettings) {
    return settings.provider === "elevenlabs"
      ? this.elevenlabs.cachedSpeech({ text, ...settings })
      : this.openai.cachedSpeech({ text, ...settings });
  }

  private generate(text: string, settings: AudioPreparationSettings) {
    return settings.provider === "elevenlabs"
      ? this.elevenlabs.speech({ text, ...settings })
      : this.openai.speech({ text, ...settings });
  }

  private snapshot(job: PreparationJob) {
    const ready = job.items.filter((item) => item.status === "ready").length;
    const failed = job.items.filter((item) => item.status === "failed").length;
    const active = job.items.some((item) => item.status === "pending" || item.status === "preparing");
    return {
      jobId: job.id,
      status: job.cancelled ? "cancelled" : ready === job.items.length ? "ready"
        : active ? "preparing" : failed ? "failed" : "preparing",
      total: job.items.length,
      ready,
      initialCached: job.initialCached,
      items: job.items.map(({ itemId, status, error }) => ({ itemId, status, ...(error ? { error } : {}) })),
    };
  }

  private pruneJobs() {
    const cutoff = Date.now() - jobTtlMs;
    for (const [jobId, job] of this.jobs) {
      if (job.updatedAt < cutoff) this.jobs.delete(jobId);
    }
  }
}

export class AudioPreparationError extends Error {
  constructor(readonly code: string, readonly statusCode: number) {
    super(code);
  }
}
