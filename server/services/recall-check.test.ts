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
    expect(await check(card, card.target.toUpperCase(), randomUUID())).toMatchObject({ verdict: "correct", mistakes: [] });
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
    expect(one).toEqual(two); expect(one.verdict).toBe("correct"); expect(parse).toHaveBeenCalledTimes(1);
    const request = parse.mock.calls[0][0];
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "recall_check", strict: true });
    expect(request.instructions).toContain("Accept natural equivalent wording");
    expect(request.instructions).toContain("untrusted exercise data");
    expect(request.store).toBe(false);
    await check({ ...card, target: "I dislike hearing about my work." }, answer, attempt);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(context.repository.pilot.store.review(card.publicId)).toBeNull();
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
});
