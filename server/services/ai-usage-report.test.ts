import { describe, expect, it } from "vitest";
import type { AiUsageSummary } from "../db/repositories/ai-usage.js";
import { diagnoseAiUsage, type ProfileAiUsageSummary } from "./ai-usage-report.js";

const row = (overrides: Partial<ProfileAiUsageSummary>): ProfileAiUsageSummary => ({
  profileId: "roman", profileName: "Roman", provider: "openai", workload: "tutor_chat",
  language: "en", model: "test-sol", operations: 10, providerRequests: 10, cacheHits: 0, errors: 0,
  inputTokens: 10_000, cachedInputTokens: 1_000, cacheWriteTokens: 0, outputTokens: 1_000,
  reasoningTokens: 500, totalTokens: 11_000, inputCharacters: 40_000,
  servedInputCharacters: 40_000,
  inputAudioBytes: 0, outputAudioBytes: 0, averageLatencyMs: 100,
  ...overrides,
} satisfies AiUsageSummary & { profileId: string; profileName: string });

describe("AI usage diagnosis", () => {
  it("flags cache, reasoning, multi-round, and error signals", () => {
    const signals = diagnoseAiUsage([row({ providerRequests: 15, errors: 2 })]);
    expect(signals).toEqual(expect.arrayContaining([
      expect.stringContaining("prompt-cache reuse is 10%"),
      expect.stringContaining("reasoning is 50%"),
      expect.stringContaining("1.5 provider requests per operation"),
      expect.stringContaining("2 failed provider request"),
    ]));
  });
});
