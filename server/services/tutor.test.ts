import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { OpenAIService } from "./openai.js";
import { genericLearnerPersona } from "./learner-persona.js";
import { TutorService } from "./tutor.js";
import { createApiTestContext } from "../testing/api-test-context.js";

describe("Tutor OpenAI requests", () => {
  const contexts: Array<ReturnType<typeof createApiTestContext>> = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (contexts.length) contexts.pop()?.close();
  });

  it("reuses a per-thread prompt cache key and records usage across tool rounds", async () => {
    const context = createApiTestContext();
    contexts.push(context);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const create = vi.fn()
      .mockResolvedValueOnce({
        id: "resp_tool",
        output_text: "",
        output: [{
          type: "function_call",
          name: "list_due_items",
          arguments: JSON.stringify({ limit: 1 }),
          call_id: "call_due",
        }],
        usage: {
          input_tokens: 1_200,
          input_tokens_details: { cached_tokens: 800, cache_write_tokens: 0 },
          output_tokens: 80,
          output_tokens_details: { reasoning_tokens: 30 },
          total_tokens: 1_280,
        },
      })
      .mockResolvedValueOnce({
        id: "resp_answer",
        output_text: "Let's practise the first phrase.",
        output: [],
        usage: {
          input_tokens: 1_350,
          input_tokens_details: { cached_tokens: 1_000, cache_write_tokens: 100 },
          output_tokens: 120,
          output_tokens_details: { reasoning_tokens: 40 },
          total_tokens: 1_470,
        },
      });
    const client = { responses: { create } } as unknown as OpenAI;
    const openaiService = {
      configured: true,
      learner: genericLearnerPersona,
      embed: vi.fn(),
    } as unknown as OpenAIService;
    const tutor = new TutorService(context.repository, openaiService, false, client);
    const clientMessageId = randomUUID();

    const result = await tutor.chat({
      language: "en",
      message: "Practise something due with me.",
      clientMessageId,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({
      reasoning: { effort: "low" },
      prompt_cache_key: `tutor:${result.threadId}`,
    });
    expect(create.mock.calls[1][0]).toMatchObject({
      prompt_cache_key: `tutor:${result.threadId}`,
    });
    expect(context.repository.tutor.getCompletedClientExchange(clientMessageId)?.metadata).toMatchObject({
      model: expect.any(String),
      usage: {
        requests: 2,
        inputTokens: 2_550,
        cachedInputTokens: 1_800,
        cacheWriteTokens: 100,
        outputTokens: 200,
        reasoningTokens: 70,
        totalTokens: 2_750,
      },
      context: {
        historyMessages: 1,
        historyCharacters: 31,
      },
    });
    expect(context.repository.aiUsage.summarize(new Date(Date.now() - 60_000))).toEqual([
      expect.objectContaining({
        workload: "tutor_chat",
        model: expect.any(String),
        operations: 1,
        providerRequests: 2,
        inputTokens: 2_550,
        cachedInputTokens: 1_800,
        outputTokens: 200,
        reasoningTokens: 70,
        totalTokens: 2_750,
      }),
    ]);
  });

  it("keeps a growing cacheable prefix beyond thirty short messages", async () => {
    const context = createApiTestContext();
    contexts.push(context);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const thread = context.repository.tutor.getOrCreateThread(undefined, "en");
    for (let index = 0; index < 40; index += 1) {
      context.repository.tutor.addMessage(
        thread.id,
        index % 2 ? "assistant" : "user",
        `short message ${index}`,
      );
    }
    const create = vi.fn().mockResolvedValue({
      id: "resp_answer",
      output_text: "Continuing.",
      output: [],
      usage: {
        input_tokens: 2_000,
        input_tokens_details: { cached_tokens: 1_500, cache_write_tokens: 0 },
        output_tokens: 30,
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 2_030,
      },
    });
    const client = { responses: { create } } as unknown as OpenAI;
    const openaiService = {
      configured: true,
      learner: genericLearnerPersona,
      embed: vi.fn(),
    } as unknown as OpenAIService;
    const tutor = new TutorService(context.repository, openaiService, false, client);

    await tutor.chat({
      language: "en",
      message: "Continue.",
      threadPublicId: thread.publicId,
      clientMessageId: randomUUID(),
    });

    expect(create.mock.calls[0][0].input).toHaveLength(41);
    expect(create.mock.calls[0][0]).toMatchObject({
      prompt_cache_key: `tutor:${thread.publicId}`,
    });
  });
});
