import type { RehearsalDatabase } from "../database.js";

export type AiProvider = "openai" | "elevenlabs";
export type AiUsageOutcome = "success" | "error";
export type AiUsageEvent = {
  operationId: string;
  provider: AiProvider;
  workload: string;
  language?: string;
  model: string;
  outcome: AiUsageOutcome;
  externalRequest?: number;
  cacheHit?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  inputCharacters?: number;
  inputAudioBytes?: number;
  outputAudioBytes?: number;
  latencyMs?: number;
};

export type AiUsageSummary = {
  provider: AiProvider;
  workload: string;
  language: string;
  model: string;
  operations: number;
  providerRequests: number;
  cacheHits: number;
  errors: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  inputCharacters: number;
  servedInputCharacters: number;
  inputAudioBytes: number;
  outputAudioBytes: number;
  averageLatencyMs: number;
};

export class AiUsageRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  record(input: AiUsageEvent) {
    this.db.prepare(`
      INSERT INTO ai_usage_events(
        operation_id, provider, workload, language_code, model, outcome, external_request, cache_hit,
        input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
        reasoning_tokens, total_tokens, input_characters, input_audio_bytes,
        output_audio_bytes, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.operationId, input.provider, input.workload, input.language || "", input.model, input.outcome,
      input.externalRequest ?? 1, input.cacheHit ?? 0, input.inputTokens ?? 0,
      input.cachedInputTokens ?? 0, input.cacheWriteTokens ?? 0, input.outputTokens ?? 0,
      input.reasoningTokens ?? 0, input.totalTokens ?? 0, input.inputCharacters ?? 0,
      input.inputAudioBytes ?? 0, input.outputAudioBytes ?? 0, input.latencyMs ?? 0,
    );
  }

  summarize(since: Date): AiUsageSummary[] {
    return this.db.prepare(`
      SELECT provider, workload, language_code AS language, model,
        COUNT(DISTINCT operation_id) AS operations,
        SUM(external_request) AS providerRequests,
        SUM(cache_hit) AS cacheHits,
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(input_tokens) AS inputTokens,
        SUM(cached_input_tokens) AS cachedInputTokens,
        SUM(cache_write_tokens) AS cacheWriteTokens,
        SUM(output_tokens) AS outputTokens,
        SUM(reasoning_tokens) AS reasoningTokens,
        SUM(total_tokens) AS totalTokens,
        SUM(CASE WHEN external_request = 1 THEN input_characters ELSE 0 END) AS inputCharacters,
        SUM(input_characters) AS servedInputCharacters,
        SUM(input_audio_bytes) AS inputAudioBytes,
        SUM(output_audio_bytes) AS outputAudioBytes,
        COALESCE(ROUND(AVG(CASE WHEN external_request = 1 THEN latency_ms END)), 0) AS averageLatencyMs
      FROM ai_usage_events
      WHERE created_at >= datetime(?)
      GROUP BY provider, workload, language_code, model
      ORDER BY totalTokens DESC, inputCharacters DESC
    `).all(since.toISOString()) as AiUsageSummary[];
  }
}
