import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextPracticeReply } from "../../contracts/tutor-context-practice.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { readyTutorCard } from "../testing/pilot-requests.js";
import { genericLearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { prepareRecallTutor } from "./tutor-recall.js";
import { TutorService } from "./tutor.js";

describe("saved contextual Tutor lessons", () => {
  let context: ApiTestContext;
  let create: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    context = createApiTestContext(); create = vi.fn();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  const service = () => new TutorService(context.repository,
    { configured: true, learner: genericLearnerPersona } as OpenAIService, false,
    { responses: { create } } as unknown as OpenAI);
  const start = (count = 1) => {
    const topic = context.repository.library.createIsland({ language: "en", title: randomUUID() });
    for (let n = 0; n < count; n++) {
      const card = context.repository.items.create({ language: "en", cue: `Ситуация ${n}`, target: `Example ${n}.`, focusTerms: [`core ${n}`] }, topic.publicId);
      readyTutorCard(context, card.publicId);
      context.db.prepare("UPDATE pilot_card_progress SET entered_at=? WHERE card_id=?").run(`2026-09-01T10:00:0${n}.000Z`, card.publicId);
    }
    const clientMessageId = randomUUID();
    const { threadId } = prepareRecallTutor(context.repository, { language: "en", clientMessageId });
    const thread = context.repository.tutor.getThread(threadId)!;
    const ids = context.repository.tutor.contextPractice.get(thread.id)!.snapshot.pool.map((target) => target.id);
    return { thread, ids, opening: { language: "en" as const, threadPublicId: threadId, clientMessageId,
      message: context.repository.tutor.getClientMessage(clientMessageId)!.content } };
  };
  const reply = (ids: string[], overrides: Partial<ContextPracticeReply> = {}): ContextPracticeReply => ({
    content: "", nextAction: "Ответь другу в этой ситуации.", selectedTargetIds: ids,
    status: "active", task: { targetIds: [ids[0]], contextId: "friends", support: "none" }, observations: [], ...overrides,
  });
  const output = (value: ContextPracticeReply) => ({ id: randomUUID(), output_text: JSON.stringify(value), output: [] });
  const send = (threadId: string, message: string, clientMessageId = randomUUID()) => service().chat({
    language: "en", threadPublicId: threadId, message, clientMessageId,
  });
  const rows = () => context.db.prepare("SELECT * FROM tutor_context_attempts ORDER BY user_message_id").all();

  it("selects once, keeps private goals through truncated history/restart and rotates only attempted goals", async () => {
    const { thread, ids, opening } = start(8);
    const chosen = [ids[0], ids[2], ids[3], ids[4], ids[5], ids[6]];
    const before = context.repository.pilot.cores.list("en", undefined, true).map((entry) => entry.cardId);
    create.mockResolvedValueOnce(output(reply(chosen)));
    await service().chat(opening);
    expect(create).toHaveBeenCalledTimes(1);
    expect(context.repository.pilot.cores.list("en", undefined, true).map((entry) => entry.cardId)).toEqual(before);
    const snapshot = context.repository.tutor.contextPractice.get(thread.id)!.snapshot;
    for (let n = 0; n < 205; n++) context.repository.tutor.addMessage(thread.id, n % 2 ? "assistant" : "user", "Old conversation.");
    context.reopen();
    create.mockResolvedValueOnce(output(reply(chosen, { observations: [{ targetId: ids[0], quote: "My answer", outcome: "not_used" }] })));
    const clientMessageId = randomUUID();
    const response = await send(thread.public_id, "My answer", clientMessageId);
    expect(await send(thread.public_id, "My answer", clientMessageId)).toMatchObject({ messageId: response.messageId });
    expect(rows()).toHaveLength(1);
    expect(context.repository.tutor.contextPractice.get(thread.id)!.snapshot).toEqual(snapshot);
    const request = create.mock.lastCall![0];
    expect(request.input.some((entry: { content: string }) => entry.content === opening.message)).toBe(false);
    expect(request.instructions).toContain('"selectedTargetIds":' + JSON.stringify(chosen));
    expect(request.instructions).toContain("Example 0.");
    expect(context.repository.pilot.cores.list("en", undefined, true).map((entry) => entry.cardId))
      .toEqual([...ids.slice(1), ids[0]]);
    // Every new ready-phrase selection shares attempt history; existing groups stay frozen.
    expect(context.repository.pilot.cores.list("en").map((entry) => entry.cardId)).toEqual([...ids.slice(1), ids[0]]);
  });

  it.each(["missing anchor", "too small", "duplicates", "outside pool", "leaked first hint"])("rejects an invalid first selection: %s", async (kind) => {
    const { thread, ids, opening } = start(8);
    const value = reply(ids.slice(0, 6));
    if (kind === "missing anchor") value.selectedTargetIds = ids.slice(1, 7);
    if (kind === "too small") value.selectedTargetIds = ids.slice(0, 4);
    if (kind === "duplicates") value.selectedTargetIds[1] = ids[0];
    if (kind === "outside pool") value.selectedTargetIds[1] = randomUUID();
    if (kind === "leaked first hint") value.task!.support = "partial";
    create.mockResolvedValueOnce(output(value));
    await expect(service().chat(opening)).rejects.toThrow("TUTOR_REPLY_INCOMPLETE");
    expect(context.repository.tutor.contextPractice.get(thread.id)!.snapshot.selectedTargetIds).toEqual([]);
    expect(context.repository.tutor.getMessages(thread.id)).toHaveLength(1);
    expect(rows()).toHaveLength(0);
  });

  it("rejects changed groups and fabricated evidence atomically, then accepts a valid retry", async () => {
    const { thread, ids, opening } = start(7);
    const chosen = ids.slice(0, 6);
    create.mockResolvedValueOnce(output(reply(chosen)));
    await service().chat(opening);
    const clientMessageId = randomUUID();
    for (const value of [
      reply([ids[0], ...ids.slice(2)]),
      reply(chosen, { observations: [{ targetId: ids[0], quote: "Invented answer", outcome: "independent" }] }),
      reply(chosen, { observations: [{ targetId: ids[1], quote: "My answer", outcome: "independent" }] }),
      reply(chosen, { status: "complete", task: null, observations: [{ targetId: ids[0], quote: "My answer", outcome: "not_used" }] }),
    ]) {
      create.mockResolvedValueOnce(output(value));
      await expect(send(thread.public_id, "My answer", clientMessageId)).rejects.toThrow("TUTOR_REPLY_INCOMPLETE");
      expect(rows()).toHaveLength(0);
      expect(context.repository.tutor.getMessages(thread.id).filter((entry) => entry.role === "assistant")).toHaveLength(1);
    }
    create.mockResolvedValueOnce(output(reply(chosen, { observations: [{ targetId: ids[0], quote: "My answer", outcome: "not_used" }] })));
    await send(thread.public_id, "My answer", clientMessageId);
    expect(rows()).toHaveLength(1);
  });

  it("does not count questions or hints as attempts, and distinguishes assistance from transfer", async () => {
    const { thread, ids, opening } = start();
    create.mockResolvedValueOnce(output(reply(ids)));
    await service().chat(opening);
    create.mockResolvedValueOnce(output(reply(ids)));
    await send(thread.public_id, "What does this situation mean?");
    expect(rows()).toHaveLength(0);
    const hinted = reply(ids, { task: { targetIds: ids, contextId: "friends", support: "partial" } });
    create.mockResolvedValueOnce(output(hinted));
    await send(thread.public_id, "Give me a hint.");
    create.mockResolvedValueOnce(output(reply(ids, { task: { targetIds: ids, contextId: "work", support: "none" },
      observations: [{ targetId: ids[0], quote: "core 0", outcome: "independent" }] })));
    const retry = randomUUID();
    await expect(send(thread.public_id, "core 0", retry)).rejects.toThrow("TUTOR_REPLY_INCOMPLETE");
    create.mockResolvedValueOnce(output(reply(ids, { task: { targetIds: ids, contextId: "work", support: "none" },
      observations: [{ targetId: ids[0], quote: "core 0", outcome: "assisted" }] })));
    await send(thread.public_id, "core 0", retry);
    create.mockResolvedValueOnce(output(reply(ids, { status: "complete", task: null, nextAction: "Продолжим с этой группой или закончим?",
      observations: [{ targetId: ids[0], quote: "core 0", outcome: "independent" }] })));
    await send(thread.public_id, "Now core 0.");
    expect(context.repository.tutor.contextPractice.get(thread.id)).toMatchObject({ status: "complete", pendingTask: null,
      progress: [{ targetId: ids[0], contexts: 2, independent: 1, assisted: 1, notUsed: 0 }] });
    const progress = context.db.prepare("SELECT * FROM pilot_card_progress").all();
    create.mockResolvedValueOnce(output(reply(ids, { task: { targetIds: ids, contextId: "travel", support: "none" } })));
    await send(thread.public_id, "Continue with this group.");
    expect(rows()).toHaveLength(2);
    expect(context.db.prepare("SELECT * FROM pilot_card_progress").all()).toEqual(progress);
  });

  it("switches to ordinary chat immediately on stop without requiring completion", async () => {
    const { thread, ids, opening } = start();
    create.mockResolvedValueOnce(output(reply(ids)));
    await service().chat(opening);
    create.mockResolvedValueOnce({ id: "switch", output_text: "", output: [
      { type: "function_call", call_id: "stop", name: "set_tutor_mode", arguments: JSON.stringify({ mode: "chat" }) },
    ] }).mockResolvedValueOnce({ id: "chat", output_text: "Конечно, закончим. Как прошёл твой день?", output: [] });
    const response = await send(thread.public_id, "Stop. Let's just chat.");
    expect(response.content).not.toContain("Next Task");
    expect(create.mock.lastCall![0].text).toBeUndefined();
    expect(context.repository.tutor.contextPractice.get(thread.id)).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("rejects stale parallel replies without appending duplicate attempts", async () => {
    const { thread, ids, opening } = start();
    create.mockResolvedValueOnce(output(reply(ids)));
    await service().chat(opening);
    let resolveFirst!: (value: ReturnType<typeof output>) => void;
    create.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const first = send(thread.public_id, "First answer");
    const rejected = expect(first).rejects.toThrow("TUTOR_CONTEXT_STALE");
    create.mockResolvedValueOnce(output(reply(ids, { observations: [{ targetId: ids[0], quote: "Second answer", outcome: "not_used" }] })));
    await send(thread.public_id, "Second answer");
    resolveFirst(output(reply(ids, { observations: [{ targetId: ids[0], quote: "First answer", outcome: "not_used" }] })));
    await rejected;
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ quote: "Second answer" });
  });

  it("keeps practice priority across representatives of one CORE and deletes evidence with its chat", async () => {
    const { thread, ids, opening } = start(2);
    create.mockResolvedValueOnce(output(reply(ids)));
    await service().chat(opening);
    create.mockResolvedValueOnce(output(reply(ids, { observations: [{ targetId: ids[0], quote: "My answer", outcome: "not_used" }] })));
    await send(thread.public_id, "My answer");
    const original = context.repository.items.get(ids[0])!;
    const other = context.repository.items.create({ language: "en", cue: "Другой пример", target: "Another example.", focusTerms: original.focusTerms }, original.topicId!);
    readyTutorCard(context, other.publicId);
    context.repository.items.delete(ids[0]);
    expect(context.repository.pilot.cores.list("en", undefined, true).map((entry) => entry.cardId)).toEqual([ids[1], other.publicId]);
    context.repository.tutor.deleteThread(thread.public_id);
    expect(rows()).toHaveLength(0);
    expect(context.db.pragma("foreign_key_check")).toEqual([]);
  });

  it("combines Homework history with new attempts and keeps profile data isolated", async () => {
    const { thread, ids, opening } = start(2);
    create.mockResolvedValueOnce(output(reply(ids)));
    await service().chat(opening);
    context.db.prepare(`INSERT INTO pilot_tutor_activities(homework_id, card_id, activity_type, message_id,
      user_response_message_id, user_response_at, created_at) VALUES ('historical', ?, 'exercise', 1, 2, ?, ?)`)
      .run(ids[0], "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(context.repository.pilot.cores.list("en", undefined, true).map((entry) => entry.cardId)).toEqual([ids[1], ids[0]]);
    const other = createApiTestContext();
    try {
      expect(other.repository.tutor.getThread(thread.public_id)).toBeUndefined();
      expect(other.db.prepare("SELECT * FROM tutor_context_attempts").all()).toEqual([]);
      expect(other.repository.pilot.cores.list("en", undefined, true)).toEqual([]);
    } finally { other.close(); }
  });
});
