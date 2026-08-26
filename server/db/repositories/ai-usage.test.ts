import { afterEach, describe, expect, it } from "vitest";
import { createApiTestContext } from "../../testing/api-test-context.js";

describe("AiUsageRepository", () => {
  const contexts: Array<ReturnType<typeof createApiTestContext>> = [];

  afterEach(() => {
    while (contexts.length) contexts.pop()?.close();
  });

  it("aggregates provider calls by workload without storing content", () => {
    const context = createApiTestContext();
    contexts.push(context);
    context.repository.aiUsage.record({
      operationId: "operation-1", provider: "openai", workload: "tutor_chat", model: "test-sol",
      outcome: "success", inputTokens: 1_000, cachedInputTokens: 600, outputTokens: 100,
      reasoningTokens: 20, totalTokens: 1_100, inputCharacters: 4_000, latencyMs: 120,
    });
    context.repository.aiUsage.record({
      operationId: "operation-1", provider: "openai", workload: "tutor_chat", model: "test-sol",
      outcome: "success", inputTokens: 1_200, cachedInputTokens: 800, outputTokens: 120,
      reasoningTokens: 30, totalTokens: 1_320, inputCharacters: 4_500, latencyMs: 180,
    });

    expect(context.repository.aiUsage.summarize(new Date(Date.now() - 60_000))).toEqual([expect.objectContaining({
      provider: "openai",
      workload: "tutor_chat",
      language: "",
      model: "test-sol",
      operations: 1,
      providerRequests: 2,
      inputTokens: 2_200,
      cachedInputTokens: 1_400,
      reasoningTokens: 50,
      totalTokens: 2_420,
      averageLatencyMs: 150,
    })]);
    const columns = (context.db.prepare("PRAGMA table_info(ai_usage_events)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).not.toEqual(expect.arrayContaining([
      "prompt", "request", "response", "content", "audio", "filename", "error_message", "profile_id",
    ]));
  });
});
