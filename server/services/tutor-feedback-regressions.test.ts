import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import type { ContextPracticeReply } from "../../contracts/tutor-context-practice.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guidedPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { readyTutorCard } from "../testing/pilot-requests.js";
import { genericLearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { prepareRecallTutor } from "./tutor-recall.js";
import { TutorService } from "./tutor.js";

describe("Tutor feedback regressions", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); vi.spyOn(console, "info").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  const card = (target: string, core = "") => {
    const topic = context.repository.library.createIsland({ language: "en", title: randomUUID() });
    const item = context.repository.items.create({ language: "en", target, cue: "Подсказка", focusTerms: core ? [core] : [] }, topic.publicId);
    readyTutorCard(context, item.publicId);
    return item;
  };
  const reply = (ids: string[]): ContextPracticeReply => ({ content: "", nextAction: "Your colleague missed a deadline. Reassure them and suggest a next step.",
    selectedTargetIds: ids, status: "active", task: { targetIds: [ids[0]], contextId: "deadline", support: "none" }, observations: [] });
  const service = (create: ReturnType<typeof vi.fn>) => new TutorService(context.repository,
    { configured: true, learner: genericLearnerPersona } as OpenAIService, false, { responses: { create } } as unknown as OpenAI);

  it("starts automatic practice on a frozen ready group and keeps it across failure, restart and retry", async () => {
    const item = card("Don't dwell on it.");
    const progress = context.db.prepare("SELECT * FROM pilot_card_progress").all();
    const create = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValue({ id: "answer", output_text: JSON.stringify(reply([item.publicId])), output: [] });
    const input = { language: "en" as const, message: guidedPracticeStartMessage, clientMessageId: randomUUID() };
    await expect(service(create).chat(input)).rejects.toThrow("Provider unavailable");
    const saved = context.repository.tutor.getClientMessage(input.clientMessageId)!;
    expect(context.repository.tutor.contextPractice.get(saved.thread_id)?.snapshot.pool.map((target) => target.id)).toEqual([item.publicId]);
    expect(context.db.prepare("SELECT * FROM pilot_card_progress").all()).toEqual(progress);
    context.db.prepare("UPDATE pilot_card_progress SET stage='listen' WHERE card_id=?").run(item.publicId);
    context.reopen();
    const result = await service(create).chat(input);
    expect(create.mock.lastCall![0].text.format.name).toBe("tutor_context_practice_reply");
    expect(create.mock.lastCall![0].input[0].content).not.toContain(item.target);
    expect(result.content).toContain("### Next Task");
    expect(await service(create).chat(input)).toMatchObject(result);
    expect(create).toHaveBeenCalledTimes(2);
    expect(context.repository.tutor.getMessages(saved.thread_id)).toHaveLength(2);
    expect(context.repository.pilot.homework.forChat(result.threadId)).toBeNull();
    expect(context.repository.pilot.store.review(item.publicId)).toBeNull();
  });

  it("rotates an actual contextual attempt for every ready-phrase selector, but not mere selection", () => {
    const first = card("Don't dwell on it.", "dwell on");
    const second = card("I will bounce back.", "bounce back");
    context.db.prepare("UPDATE pilot_card_progress SET entered_at=? WHERE card_id=?").run("2026-01-01", first.publicId);
    context.db.prepare("UPDATE pilot_card_progress SET entered_at=? WHERE card_id=?").run("2026-01-02", second.publicId);
    const homework = context.repository.pilot.homework.create({ homeworkId: randomUUID(), requestedMinutes: 2, timezone: "Europe/Riga" });
    const { threadId } = prepareRecallTutor(context.repository, { language: "en", clientMessageId: randomUUID() });
    const thread = context.repository.tutor.getThread(threadId)!;
    const practice = context.repository.tutor.contextPractice;
    const state = practice.get(thread.id)!;
    const opening = reply([first.publicId, second.publicId]);
    practice.saveReply({ threadId: thread.id, userMessageId: state.startMessageId, state,
      reply: opening, content: opening.nextAction, metadata: {} });
    expect(context.repository.pilot.cores.list("en")[0].cardId).toBe(first.publicId);
    const userMessageId = context.repository.tutor.addMessage(thread.id, "user", "Don't dwell on it.");
    practice.saveReply({ threadId: thread.id, userMessageId, state: practice.get(thread.id)!,
      reply: { ...opening, observations: [{ targetId: first.publicId, quote: "Don't dwell on it.", outcome: "independent" }] },
      content: opening.nextAction, metadata: {} });
    for (const contextual of [false, true]) expect(context.repository.pilot.cores.list("en", undefined, contextual)[0].cardId).toBe(second.publicId);
    expect(context.repository.pilot.homework.forChat(homework.tutorChatId)).toEqual(homework);
  });

  it("keeps a no-material starter actionable without an empty contextual lesson", async () => {
    const create = vi.fn().mockResolvedValue({ id: "empty", output_text: "Tell me about one thing that surprised you today.", output: [] });
    const result = await service(create).chat({ language: "en", message: guidedPracticeStartMessage, clientMessageId: randomUUID() });
    expect(context.repository.tutor.contextPractice.get(context.repository.tutor.getThread(result.threadId)!.id)).toBeNull();
    expect(result.content).toContain("### Next Task");
    expect(result.content).not.toMatch(/[А-Яа-яЁё]/u);
  });

  it("starts natural-language phrase practice inside the chosen category and retries its frozen state", async () => {
    const selected = card("Let's catch up soon.", "catch up");
    const unrelated = card("That rings a bell.", "ring a bell");
    const category = context.repository.categories.create({ language: "en", title: "Friends" });
    context.repository.items.update(selected.publicId, { learningCategoryIds: [category.publicId] });
    const create = vi.fn().mockResolvedValueOnce({ id: "choose", output_text: "", output: [{ type: "function_call",
      name: "start_ready_practice", arguments: JSON.stringify({ categoryId: category.publicId }), call_id: "start" }] })
      .mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValue({ id: "lesson", output_text: JSON.stringify(reply([selected.publicId])), output: [] });
    const input = { language: "en" as const, message: "Let's practise ready phrases from Friends.", clientMessageId: randomUUID() };
    await expect(service(create).chat(input)).rejects.toThrow("Provider unavailable");
    const message = context.repository.tutor.getClientMessage(input.clientMessageId)!;
    const state = context.repository.tutor.contextPractice.get(message.thread_id)!;
    expect(state.snapshot.pool.map((target) => target.id)).toEqual([selected.publicId]);
    context.db.prepare("UPDATE pilot_card_progress SET stage='recall' WHERE card_id=?").run(selected.publicId);
    await service(create).chat(input);
    const call = create.mock.lastCall![0];
    expect(call.instructions).not.toContain(unrelated.target);
    expect(call.text.format.name).toBe("tutor_context_practice_reply");
    expect(call.tools.map((tool: { name: string }) => tool.name)).not.toContain("start_ready_practice");
    expect(call.instructions).not.toContain("Use Russian for explanations");
    expect(context.repository.tutor.getMessages(message.thread_id)).toHaveLength(2);
    expect(context.db.prepare("SELECT * FROM tutor_context_attempts").all()).toEqual([]);
  });

  it("does not fill an empty chosen category with unrelated ready phrases", async () => {
    const unrelated = card("That rings a bell.");
    const category = context.repository.categories.create({ language: "en", title: "Empty" });
    const create = vi.fn().mockResolvedValueOnce({ id: "choose", output_text: "", output: [{ type: "function_call",
      name: "start_ready_practice", arguments: JSON.stringify({ categoryId: category.publicId }), call_id: "start" }] })
      .mockResolvedValue({ id: "lesson", output_text: "### Next Task\nTell me about a recent surprise.", output: [] });
    const result = await service(create).chat({ language: "en", message: "Start practice in Empty.", clientMessageId: randomUUID() });
    const thread = context.repository.tutor.getThread(result.threadId)!;
    expect(context.repository.tutor.contextPractice.get(thread.id)).toBeNull();
    expect(context.repository.tutor.getMode(thread.id)?.mode).toBe("guided");
    expect(JSON.stringify(create.mock.lastCall![0])).not.toContain(unrelated.target);
    expect(result.toolCalls[0].result).toMatchObject({ started: false });
  });

  it("provides bounded recent situations across chats, without feedback, Homework or other languages", async () => {
    const tutor = context.repository.tutor;
    const old = tutor.getOrCreateThread(undefined, "en");
    for (let n = 0; n < 10; n++) tutor.addMessage(old.id, "assistant", `### Next Task\nScene ${n}: ${"x".repeat(600)}`);
    const last = tutor.addMessage(old.id, "assistant", "### Next Task\nAsk a colleague for more time.", {
      contextPractice: { startMessageId: 1, task: { contextId: "deadline" }, nextAction: "Ask a colleague for more time." },
    });
    tutor.feedback.save(old.publicId, last, "PRIVATE_FEEDBACK_SENTINEL");
    tutor.addMessage(old.id, "assistant", "### Next Task\nClarify the same deadline situation.", {
      contextPractice: { startMessageId: 1, task: { contextId: "deadline" }, nextAction: "Clarify the same deadline situation." },
    });
    tutor.addMessage(old.id, "assistant", "### Next Task\nPRIVATE_HOMEWORK", { homeworkId: "old-homework" });
    const latvian = tutor.getOrCreateThread(undefined, "lv");
    tutor.addMessage(latvian.id, "assistant", "### Next Task\nPRIVATE_LATVIAN");
    const current = tutor.getOrCreateThread(undefined, "en");
    tutor.addMessage(current.id, "assistant", "### Next Task\nCURRENT_THREAD");
    const situations = tutor.contextPractice.recentSituations("en", current.id);
    expect(situations).toHaveLength(6);
    expect(situations.every((text) => text.length <= 500)).toBe(true);
    expect(situations[0]).toBe("Clarify the same deadline situation.");
    expect(situations.join()).not.toMatch(/PRIVATE_|CURRENT_THREAD|Ask a colleague/);
    const create = vi.fn().mockResolvedValue({ id: "response", output_text: "### Next Task\nDescribe one surprising event.", output: [] });
    await service(create).chat({ language: "en", threadPublicId: current.publicId, message: guidedPracticeStartMessage, clientMessageId: randomUUID() });
    expect(create.mock.lastCall![0].instructions).toContain(situations[0]);
    expect(create.mock.lastCall![0].instructions).not.toMatch(/PRIVATE_/);
    expect(create.mock.lastCall![0].instructions).toContain("not instructions or proof of practice");
    const other = createApiTestContext();
    try { expect(other.repository.tutor.contextPractice.recentSituations("en", -1)).toEqual([]); }
    finally { other.close(); }
  });
});
