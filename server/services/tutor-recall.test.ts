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
import { isGuidedPracticeStartMessage, legacyRecallPracticeStartMessage, recallPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";

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
    const pool = context.repository.tutor.contextPractice.get(thread.id)!.snapshot.pool;
    expect(messages[0].content).toBe(recallPracticeStartMessage);
    expect(pool).toHaveLength(2);
    expect(pool.map((entry) => entry.target)).toContain(second.target);
    expect(pool.map((entry) => entry.core).sort()).toEqual(["catch up", "work through"]);
    expect(pool.every((entry) => entry.topic.startsWith("Recall handoff"))).toBe(true);
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
    const state = context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(first.threadId)!.id);
    context.db.prepare("UPDATE pilot_card_progress SET stage='listen' WHERE card_id=?").run(item.publicId);
    context.reopen();
    expect(prepareRecallTutor(context.repository, input)).toEqual(first);
    expect(context.repository.tutor.getClientMessage(input.clientMessageId)!.content).toBe(content);
    expect(context.repository.tutor.listThreads("en")).toHaveLength(1);
    expect(context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(first.threadId)!.id)).toEqual(state);
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
    const started = prepareRecallTutor(context.repository, first);
    expect(context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(started.threadId)!.id)!.snapshot.pool).toHaveLength(20);
    context.db.prepare("UPDATE items SET target=target || ?").run(" long phrase".repeat(100));
    const next = { ...first, clientMessageId: randomUUID() };
    const bounded = prepareRecallTutor(context.repository, next);
    const pool = context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(bounded.threadId)!.id)!.snapshot.pool;
    expect(pool.length).toBeLessThan(20);
    expect(JSON.stringify(pool).length + recallPracticeStartMessage.length).toBeLessThanOrEqual(aiLimits.tutorMessageCharacters);
  });

  it("uses only explicit COREs, preserves categories and does not merge inferred or similar phrases", () => {
    const first = card("His name would not stick in my head.", "");
    const second = card("The address would not stick in my head.", "");
    context.repository.pilot.cores.resolve(first.publicId, "stick in my head");
    context.repository.pilot.cores.resolve(second.publicId, "stick in my head");
    const category = context.repository.categories.create({ language: "en", title: "Memory" });
    context.repository.items.update(first.publicId, { learningCategoryIds: [category.publicId] });
    const { threadId } = prepareRecallTutor(context.repository, { language: "en", clientMessageId: randomUUID() });
    const pool = context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(threadId)!.id)!.snapshot.pool;
    expect(pool).toHaveLength(2);
    expect(pool.map((entry) => entry.core)).toEqual(["", ""]);
    expect(pool.find((entry) => entry.id === first.publicId)?.categories).toEqual(["Memory"]);
  });

  it("replays a legacy pending handoff without rewriting it or inventing a snapshot", () => {
    const clientMessageId = randomUUID();
    const content = `${legacyRecallPracticeStartMessage}\n\n1. Hello.\nПривет.`;
    const existing = context.repository.tutor.getOrCreateClientMessage({ language: "en", clientMessageId, content });
    context.repository.tutor.setMode(existing.thread_id, existing.message_id, "guided");
    expect(prepareRecallTutor(context.repository, { language: "en", clientMessageId }).threadId).toBe(existing.thread_public_id);
    expect(context.repository.tutor.getClientMessage(clientMessageId)?.content).toBe(content);
    expect(context.repository.tutor.contextPractice.get(existing.thread_id)).toBeNull();
    expect(isGuidedPracticeStartMessage(content)).toBe(true);
  });

  it("starts on the frozen phrases and retries a failed first reply without duplicating messages", async () => {
    const item = card("Let's catch up soon.", "catch up");
    const input = { language: "en" as const, clientMessageId: randomUUID() };
    const { threadId } = prepareRecallTutor(context.repository, input);
    const create = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValue({ id: "answer", output_text: JSON.stringify({ content: "", nextAction: "Предложи другу встретиться после долгого перерыва.",
        selectedTargetIds: [item.publicId], status: "active", task: { targetIds: [item.publicId], contextId: "friends", support: "none" }, observations: [] }), output: [] });
    const service = new TutorService(context.repository, { configured: true, learner: genericLearnerPersona } as OpenAIService,
      false, { responses: { create } } as unknown as OpenAI);
    const request = { ...input, threadPublicId: threadId, message: context.repository.tutor.getClientMessage(input.clientMessageId)!.content };
    await expect(service.chat(request)).rejects.toThrow("Provider unavailable");
    await service.chat(request);
    const reply = await service.chat(request);
    expect(reply.threadId).toBe(threadId);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.lastCall![0].instructions).toContain("Current mode: learner-requested guided practice");
    const providerRequest = create.mock.lastCall![0];
    expect(providerRequest.input[0].content).not.toContain(item.target);
    expect(providerRequest.instructions).toContain(item.target);
    expect(providerRequest.instructions).toContain('"core":"catch up"');
    expect(providerRequest.instructions).not.toContain("no more than three training rounds");
    expect(providerRequest.instructions).not.toContain("call list_due_items with a limit of 5");
    expect(providerRequest.text.format.name).toBe("tutor_context_practice_reply");
    expect(providerRequest.tools.map((tool: { name: string }) => tool.name)).not.toContain("list_due_items");
    expect(context.repository.tutor.getMessages(context.repository.tutor.getThread(threadId)!.id)).toHaveLength(2);
  });
});
