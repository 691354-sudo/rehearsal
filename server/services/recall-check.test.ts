import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { createRecallChecker } from "./recall-check.js";
import { matchesRecallAnswer } from "../../contracts/recall-check.js";

describe("English semantic Recall checking", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); vi.spyOn(console, "info").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  const item = () => {
    const topic = context.repository.library.createIsland({ language: "en", title: "Checking" });
    return context.repository.items.create({ language: "en", cue: "Мне нравится узнавать, как другие воспринимают мою работу.",
      target: "I love hearing how other people interpret my work." }, topic.publicId);
  };
  it("accepts exact normalized answers without a provider, but never uses similarity for a verdict", async () => {
    const card = item();
    const check = createRecallChecker(null, context.repository.aiUsage);
    expect(await check(card, card.target.toUpperCase(), randomUUID())).toMatchObject({ verdict: "correct", explanationRu: "", mistakes: [] });
    expect(matchesRecallAnswer("I don't like it", ["I like it"])).toBe(false);
    expect(matchesRecallAnswer("He goes home", ["He go home"])).toBe(false);
    expect(matchesRecallAnswer(" ", [" "])).toBe(false);
    await expect(check(card, "I love knowing how people see my work.", randomUUID())).rejects.toThrow("OPENAI_NOT_CONFIGURED");
  });
  it("accepts equivalent wording, deduplicates concurrent checks and rechecks an edited reference", async () => {
    const card = item(), attempt = randomUUID();
    const answer = "I love knowing how people see my work.";
    const parse = vi.fn().mockResolvedValue({ status: "completed", output_parsed: { verdict: "correct", explanationRu: "Верно: смысл сохранён.", correctedAnswer: answer, mistakes: [] } });
    const check = createRecallChecker({ responses: { parse } } as unknown as OpenAI, context.repository.aiUsage);
    const [one, two] = await Promise.all([check(card, answer, attempt), check(card, answer, attempt)]);
    expect(one).toEqual(two); expect(one).toMatchObject({ verdict: "correct", explanationRu: "", correctedAnswer: answer });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(await check(card, answer, randomUUID())).toEqual(one);
    expect(parse).toHaveBeenCalledTimes(1);
    const request = parse.mock.calls[0][0];
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "recall_check", strict: true });
    expect(request.instructions).toContain("Accept natural equivalent wording");
    expect(request.instructions).toContain("untrusted exercise data");
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(2000);
    expect(parse.mock.calls[0][1]).toEqual({ timeout: 20_000, maxRetries: 0 });
    await check({ ...card, target: "I dislike hearing about my work." }, answer, attempt);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(context.repository.aiUsage.summarize(new Date(0))).toEqual([expect.objectContaining({
      workload: "recall_check", providerRequests: 2, cacheHits: 2,
    })]);
    expect(context.repository.pilot.store.review(card.publicId)).toBeNull();
  });
  it("accepts compact correct replies but requires an explanation and correction for errors", async () => {
    const card = item(), answer = "I love knowing how people see my work.";
    const parse = vi.fn().mockResolvedValue({ status: "completed", output_parsed: {
      verdict: "correct", explanationRu: "", correctedAnswer: "", mistakes: [],
    } });
    const check = createRecallChecker({ responses: { parse } } as unknown as OpenAI, context.repository.aiUsage);
    expect(await check(card, answer, randomUUID())).toEqual({ verdict: "correct", explanationRu: "", correctedAnswer: answer, mistakes: [] });
    parse.mockResolvedValue({ status: "completed", output_parsed: {
      verdict: "incorrect", explanationRu: "", correctedAnswer: answer, mistakes: [],
    } });
    await expect(check(card, "I loves knowing how people see my work.", randomUUID())).rejects.toThrow("RECALL_CHECK_INVALID");
  });
  it("keeps cached checks private and invalidates changes to the answer, cue or accepted wording", async () => {
    const card = item(), answer = "I love knowing how people see my work.";
    const parse = vi.fn().mockResolvedValue({ status: "completed", output_parsed: {
      verdict: "correct", explanationRu: "", correctedAnswer: "", mistakes: [],
    } });
    const client = { responses: { parse } } as unknown as OpenAI;
    const check = createRecallChecker(client, context.repository.aiUsage);
    await check(card, answer, randomUUID());
    await check(card, answer + " ", randomUUID());
    await check({ ...card, cue: "Другой смысл" }, answer, randomUUID());
    await check({ ...card, acceptedAnswers: ["Another wording."] }, answer, randomUUID());
    const otherProfile = createApiTestContext();
    try { await createRecallChecker(client, otherProfile.repository.aiUsage)(card, answer, randomUUID()); }
    finally { otherProfile.close(); }
    expect(parse).toHaveBeenCalledTimes(5);
  });
  it("returns literal error fragments and recovers after invalid, incomplete or failed checks", async () => {
    const card = item(), attempt = randomUUID(), answer = "I loves hearing how people see my work.";
    const result = { verdict: "incorrect", explanationRu: "После I нужна форма love.", correctedAnswer: "I love hearing how people see my work.", mistakes: [{ original: "loves", correction: "love" }] };
    const parse = vi.fn().mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ status: "incomplete", output_parsed: result })
      .mockResolvedValueOnce({ status: "completed", output_parsed: null })
      .mockResolvedValueOnce({ status: "completed", output_parsed: { ...result, mistakes: [{ original: "invented", correction: "love" }] } })
      .mockResolvedValue({ status: "completed", output_parsed: result });
    const check = createRecallChecker({ responses: { parse } } as unknown as OpenAI, context.repository.aiUsage);
    for (let n = 0; n < 4; n++) await expect(check(card, answer, attempt)).rejects.toThrow();
    expect(await check(card, answer, attempt)).toEqual(result);
    expect(parse).toHaveBeenCalledTimes(5);
  });
  it("bounds cached results while retaining recent reuse and keeping local matches out of the cache", async () => {
    const card = item();
    const parse = vi.fn().mockResolvedValue({ status: "completed", output_parsed: {
      verdict: "correct", explanationRu: "", correctedAnswer: "", mistakes: [],
    } });
    const check = createRecallChecker({ responses: { parse } } as unknown as OpenAI, context.repository.aiUsage);
    for (let n = 0; n < 512; n++) await check(card, `Alternative ${n}`, randomUUID());
    await check(card, card.target, randomUUID());
    await check(card, "Alternative 0", randomUUID());
    expect(parse).toHaveBeenCalledTimes(512);
    await check(card, "Alternative 512", randomUUID());
    await check(card, "Alternative 0", randomUUID());
    expect(parse).toHaveBeenCalledTimes(513);
    await check(card, "Alternative 1", randomUUID());
    expect(parse).toHaveBeenCalledTimes(514);
  });
});
