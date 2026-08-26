import { randomUUID } from "node:crypto";
import type {
  AiProvider,
  AiUsageEvent,
  AiUsageRepository,
} from "../db/repositories/ai-usage.js";

export type AiWorkload =
  | "tutor_chat"
  | "tutor_review"
  | "capture_prepare"
  | "text_import_prepare"
  | "delimited_import_prepare"
  | "vocabulary_prepare"
  | "pattern_drill_prepare"
  | "batch_revision"
  | "review_resolution"
  | "candidate_revision"
  | "library_item_rewrite"
  | "currency_check"
  | "embedding"
  | "transcription"
  | "speech";

type UsageNumbers = Partial<Pick<AiUsageEvent,
  "inputTokens" | "cachedInputTokens" | "cacheWriteTokens" | "outputTokens" |
  "reasoningTokens" | "totalTokens" | "outputAudioBytes"
>>;

type TrackAiRequest<T> = {
  repository: AiUsageRepository;
  provider: AiProvider;
  workload: AiWorkload;
  language?: string;
  model: string;
  operationId?: string;
  inputCharacters?: number;
  inputAudioBytes?: number;
  measure?: (result: T) => UsageNumbers;
};

const safeRecord = (repository: AiUsageRepository, event: AiUsageEvent) => {
  try {
    repository.record(event);
  } catch {
    console.error(JSON.stringify({ event: "ai_usage_record_failed", provider: event.provider, workload: event.workload }));
  }
};

export const trackAiRequest = async <T>(
  input: TrackAiRequest<T>,
  request: () => Promise<T>,
): Promise<T> => {
  const operationId = input.operationId || randomUUID();
  const startedAt = Date.now();
  const base = {
    operationId,
    provider: input.provider,
    workload: input.workload,
    language: input.language,
    model: input.model,
    externalRequest: 1,
    inputCharacters: input.inputCharacters || 0,
    inputAudioBytes: input.inputAudioBytes || 0,
  } as const;
  try {
    const result = await request();
    safeRecord(input.repository, {
      ...base,
      outcome: "success",
      latencyMs: Date.now() - startedAt,
      ...(input.measure?.(result) || {}),
    });
    return result;
  } catch (error) {
    safeRecord(input.repository, {
      ...base,
      outcome: "error",
      latencyMs: Date.now() - startedAt,
    });
    throw error;
  }
};

export const recordAiCacheHit = (input: Omit<TrackAiRequest<unknown>, "measure">) => {
  safeRecord(input.repository, {
    operationId: input.operationId || randomUUID(),
    provider: input.provider,
    workload: input.workload,
    language: input.language,
    model: input.model,
    outcome: "success",
    externalRequest: 0,
    cacheHit: 1,
    inputCharacters: input.inputCharacters || 0,
    inputAudioBytes: input.inputAudioBytes || 0,
  });
};

export const responseTokenUsage = (response: unknown): UsageNumbers => {
  const usage = (response as {
    usage?: {
      input_tokens?: number;
      input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
      total_tokens?: number;
    };
  }).usage;
  return usage ? {
    inputTokens: usage.input_tokens || 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens || 0,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  } : {};
};

export const embeddingTokenUsage = (response: unknown): UsageNumbers => {
  const usage = (response as { usage?: { prompt_tokens?: number; total_tokens?: number } }).usage;
  return usage ? { inputTokens: usage.prompt_tokens || 0, totalTokens: usage.total_tokens || 0 } : {};
};

export const transcriptionTokenUsage = (response: unknown): UsageNumbers => {
  const usage = (response as {
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  }).usage;
  return usage && "input_tokens" in usage ? {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: usage.total_tokens || 0,
  } : {};
};
