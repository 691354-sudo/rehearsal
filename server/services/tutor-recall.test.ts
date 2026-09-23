import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { readyTutorCard } from "../testing/pilot-requests.js";
import { genericLearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { TutorService } from "./tutor.js";
import { prepareRecallTutor } from "./tutor-recall.js";
import { aiLimits } from "./ai-limits.js";
import { isGuidedPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";

describe("Recall to a fresh Tutor chat", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); vi.spyOn(console, "info").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  const card = (target: string, core: string, language: "en" | "lv" = "en") => {
    const topic = context.repository.library.createIsland({ language, title: `Recall handoff ${randomUUID()}` });
    const item = context.repository.items.create({ language, target, cue: "Подсказка", focusTerms: [core] }, topic.publicId);
    readyTutorCard(context, item.publicId); return item;
  };

  it("creates a separate guided chat from ready COREs in this language, without Homework or FSRS writes", async () => {
    const old = context.repository.tutor.getOrCreateClientMessage({ language: "en", clientMessageId: randomUUID(), content: "Old conversation" });
    const first = card("We can work through it.", "work through");
    card("I will work through it.", "work through");
    const second = card("Let's catch up soon.", "catch up");
    card("Sveiki!", "Sveiki", "lv");
    const notReady = card("Not ready yet.", "Not ready");
    context.db.prepare("UPDATE pilot_card_progress SET stage='recall' WHERE card_id=?").run(notReady.publicId);
    const progress = context.db.prepare("SELECT * FROM pilot_card_progress ORDER BY card_id").all();
    const app = await buildApp(context.repository);
    const clientMessageId = randomUUID();
    const response = await app.inject({ method: "POST", url: "/api/pilot/tutor-chat", payload: { language: "en", clientMessageId } });
    expect(response.statusCode).toBe(200);
    expect(response.json().threadId).not.toBe(old.thread_public_id);
    const thread = context.repository.tutor.getThread(response.json().threadId)!;
    const messages = context.repository.tutor.getMessages(thread.id, 50, true);
    expect(messages).toHaveLength(1);
    expect(messages[0].clientMessageId).toBe(clientMessageId);
    expect(isGuidedPracticeStartMessage(messages[0].content)).toBe(true);
    expect(messages[0].content).toContain(second.target);
    expect(messages[0].content.match(/work through/g)).toHaveLength(1);
    expect(messages[0].content).not.toContain("Sveiki");
    expect(messages[0].content).not.toContain(notReady.target);
    expect(context.repository.tutor.getMode(thread.id)?.mode).toBe("guided");
    expect(context.repository.pilot.homework.forChat(thread.public_id)).toBeNull();
    expect(context.db.prepare("SELECT * FROM pilot_card_progress ORDER BY card_id").all()).toEqual(progress);
    expect(context.repository.items.get(first.publicId)).toEqual(first);
    await app.close();
  });

  it("freezes the opening phrases across retries and server restarts, even after readiness changes", () => {
    const item = card("Let's catch up soon.", "catch up");
    const input = { language: "en" as const, clientMessageId: randomUUID() };
    const first = prepareRecallTutor(context.repository, input);
    const content = context.repository.tutor.getClientMessage(input.clientMessageId)!.content;
    context.db.prepare("UPDATE pilot_card_progress SET stage='listen' WHERE card_id=?").run(item.publicId);
    context.reopen();
    expect(prepareRecallTutor(context.repository, input)).toEqual(first);
    expect(context.repository.tutor.getClientMessage(input.clientMessageId)!.content).toBe(content);
    expect(context.repository.tutor.listThreads("en")).toHaveLength(1);
    expect(() => prepareRecallTutor(context.repository, { ...input, language: "lv" })).toThrow("CLIENT_MESSAGE_ID_CONFLICT");
  });

  it("does not create an empty chat when no phrases are ready and rejects reuse of an ordinary message", () => {
    expect(() => prepareRecallTutor(context.repository, { language: "en", clientMessageId: randomUUID() })).toThrow("NO_TUTOR_CARDS");
    expect(context.db.prepare("SELECT * FROM chat_threads").all()).toHaveLength(0);
    const clientMessageId = randomUUID();
    context.repository.tutor.getOrCreateClientMessage({ language: "en", clientMessageId, content: "Hello" });
    expect(() => prepareRecallTutor(context.repository, { language: "en", clientMessageId })).toThrow("CLIENT_MESSAGE_ID_CONFLICT");
  });

  it("bounds a large ready pool by 20 COREs and the message budget", () => {
    for (let n = 0; n < 30; n++) card(`Phrase number ${n}.`, `number ${n}`);
    const first = { language: "en" as const, clientMessageId: randomUUID() };
    prepareRecallTutor(context.repository, first);
    expect(context.repository.tutor.getClientMessage(first.clientMessageId)!.content.match(/\n\n\d+\./g)).toHaveLength(20);
    context.db.prepare("UPDATE items SET target=target || ?").run(" long phrase".repeat(100));
    const next = { ...first, clientMessageId: randomUUID() };
    prepareRecallTutor(context.repository, next);
    expect(context.repository.tutor.getClientMessage(next.clientMessageId)!.content.length).toBeLessThanOrEqual(aiLimits.tutorMessageCharacters);
  });

  it("starts on the frozen phrases and retries a failed first reply without duplicating messages", async () => {
    const item = card("Let's catch up soon.", "catch up");
    const input = { language: "en" as const, clientMessageId: randomUUID() };
    const { threadId } = prepareRecallTutor(context.repository, input);
    const create = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValue({ id: "answer", output_text: "Use catch up to arrange a meeting.", output: [] });
    const service = new TutorService(context.repository, { configured: true, learner: genericLearnerPersona } as OpenAIService,
      false, { responses: { create } } as unknown as OpenAI);
    const request = { ...input, threadPublicId: threadId, message: context.repository.tutor.getClientMessage(input.clientMessageId)!.content };
    await expect(service.chat(request)).rejects.toThrow("Provider unavailable");
    await service.chat(request);
    const reply = await service.chat(request);
    expect(reply.threadId).toBe(threadId);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.lastCall![0].instructions).toContain("Current mode: learner-requested guided practice");
    expect(create.mock.lastCall![0].input[0].content).toContain(item.target);
    expect(context.repository.tutor.getMessages(context.repository.tutor.getThread(threadId)!.id)).toHaveLength(2);
  });
});
