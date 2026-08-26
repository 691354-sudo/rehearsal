import type { AiUsageSummary } from "../db/repositories/ai-usage.js";

export type ProfileAiUsageSummary = AiUsageSummary & { profileId: string; profileName: string };

const percent = (part: number, total: number) => total ? Math.round(part / total * 100) : 0;
const workloadLabel = (row: ProfileAiUsageSummary) =>
  `${row.workload}${row.language ? ` (${row.language})` : ""}`;

export const diagnoseAiUsage = (rows: ProfileAiUsageSummary[]) => {
  if (!rows.length) return ["No AI usage was recorded for this period."];
  const signals: string[] = [];
  const tokenRows = rows.filter((row) => row.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens);
  if (tokenRows[0]) {
    const top = tokenRows[0];
    signals.push(
      `Top token workload: ${top.profileName} / ${workloadLabel(top)} / ${top.model} (${top.totalTokens.toLocaleString()} tokens).`,
    );
  }
  for (const row of rows) {
    if (row.errors) {
      signals.push(`${row.profileName} / ${workloadLabel(row)}: ${row.errors} failed provider request(s); check retry loops.`);
    }
    if (row.workload === "tutor_chat" && row.inputTokens >= 1_000
      && percent(row.cachedInputTokens, row.inputTokens) < 30) {
      signals.push(
        `${row.profileName} / Tutor: prompt-cache reuse is ${percent(row.cachedInputTokens, row.inputTokens)}%; inspect prefix churn and long context.`,
      );
    }
    if (row.outputTokens >= 100 && percent(row.reasoningTokens, row.outputTokens) > 40) {
      signals.push(
        `${row.profileName} / ${workloadLabel(row)}: reasoning is ${percent(row.reasoningTokens, row.outputTokens)}% of output tokens; compare quality against a tighter prompt or lighter model.`,
      );
    }
    if (row.operations && row.providerRequests / row.operations > 1.3) {
      signals.push(
        `${row.profileName} / ${workloadLabel(row)}: ${(row.providerRequests / row.operations).toFixed(1)} provider requests per operation; inspect tool or chunk rounds.`,
      );
    }
    const speechRequests = row.providerRequests + row.cacheHits;
    if (row.workload === "speech" && speechRequests >= 10 && percent(row.cacheHits, speechRequests) < 25) {
      signals.push(
        `${row.profileName} / ${row.provider} speech: local cache hit rate is ${percent(row.cacheHits, speechRequests)}%; inspect unstable voice, speed, or text keys.`,
      );
    }
  }
  return signals.length ? signals : ["No automatic leak signals crossed the current thresholds."];
};

export const reportTableRows = (rows: ProfileAiUsageSummary[]) => rows.map((row) => ({
  profile: row.profileName,
  workload: row.workload,
  language: row.language || "-",
  provider: row.provider,
  model: row.model,
  operations: row.operations,
  requests: row.providerRequests,
  errors: row.errors,
  "prompt cache %": percent(row.cachedInputTokens, row.inputTokens),
  "speech hits": row.cacheHits,
  "speech cache %": percent(row.cacheHits, row.cacheHits + row.providerRequests),
  input: row.inputTokens,
  cached: row.cachedInputTokens,
  "cache write": row.cacheWriteTokens,
  output: row.outputTokens,
  reasoning: row.reasoningTokens,
  total: row.totalTokens,
  "tokens / op": row.operations ? Math.round(row.totalTokens / row.operations) : 0,
  "provider chars": row.inputCharacters,
  "chars / request": row.providerRequests ? Math.round(row.inputCharacters / row.providerRequests) : 0,
  "served chars": row.servedInputCharacters,
  "audio in": row.inputAudioBytes,
  "audio out": row.outputAudioBytes,
  "avg ms": row.averageLatencyMs,
}));
