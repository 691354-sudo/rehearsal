import { afterEach, describe, expect, it } from "vitest";
import { createApiTestContext } from "../testing/api-test-context.js";
import { trackAiRequest } from "./ai-usage.js";

describe("AI usage tracking", () => {
  const contexts: Array<ReturnType<typeof createApiTestContext>> = [];

  afterEach(() => {
    while (contexts.length) contexts.pop()?.close();
  });

  it("records a failed provider call without replacing the original error", async () => {
    const context = createApiTestContext();
    contexts.push(context);
    const providerError = new Error("provider unavailable");

    await expect(trackAiRequest({
      repository: context.repository.aiUsage,
      provider: "openai",
      workload: "embedding",
      model: "test-embedding",
      inputCharacters: 20,
    }, () => Promise.reject(providerError))).rejects.toBe(providerError);

    expect(context.repository.aiUsage.summarize(new Date(Date.now() - 60_000))).toEqual([
      expect.objectContaining({
        workload: "embedding",
        providerRequests: 1,
        errors: 1,
        inputCharacters: 20,
        totalTokens: 0,
      }),
    ]);
  });
});
