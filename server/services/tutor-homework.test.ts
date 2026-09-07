import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import type { OpenAIService } from "./openai.js";
import { genericLearnerPersona } from "./learner-persona.js";
import { TutorService } from "./tutor.js";
import { parseHomeworkReply } from "./tutor-homework.js";

describe("Homework Tutor provider contract", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); vi.spyOn(console, "info").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  it("saves structured activities in the same chat and retries an incomplete response without duplicating the user", async () => {
    const p = context.repository.pilot;
    const topic = context.repository.library.createIsland({ language: "en", title: "Homework test" });
    const card = context.repository.items.create({ language: "en", cue: "Я справлюсь", target: "I can pull through." }, topic.publicId);
    p.listening.like({ eventId: randomUUID(), language: "en", cardId: card.publicId, liked: true, occurredAt: new Date().toISOString() });
    const hw = p.homework.create({ homeworkId: randomUUID(), requestedMinutes: 2, timezone: "Europe/Riga" });
    const create = vi.fn().mockResolvedValueOnce({ id: "incomplete", output: [], output_text: '{"content":' })
      .mockResolvedValue({ id: "complete", output: [], output_text: JSON.stringify({ content: "### Meaning\n\nЯ справлюсь.", activities: [{ cardId: card.publicId, activityType: "explanation", exerciseType: null }], respondedToMessageIds: [] }) });
    const service = new TutorService(context.repository, { configured: true, learner: genericLearnerPersona } as OpenAIService,
      false, { responses: { create } } as unknown as OpenAI);
    const request = { language: "en" as const, threadPublicId: hw.tutorChatId, message: "Начнём", clientMessageId: randomUUID(), homeworkId: hw.homeworkId, homeworkPlanning: true };
    await expect(service.chat(request)).rejects.toThrow("TUTOR_REPLY_INCOMPLETE");
    const reply = await service.chat(request);
    expect(reply.threadId).toBe(hw.tutorChatId);
    const call = create.mock.calls[1][0];
    expect(call.text.format).toMatchObject({ type: "json_schema", name: "homework_tutor_reply", strict: true });
    expect(call.instructions).toContain('"latestRating":null');
    expect(call.instructions).toContain('"source":"listen_like"');
    expect(call.instructions).toContain("in Russian");
    const thread = context.repository.tutor.getThread(hw.tutorChatId)!;
    expect(context.repository.tutor.getMessages(thread.id, 100).filter((entry) => entry.role === "user")).toHaveLength(1);
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM pilot_tutor_activities").get()).toEqual({ n: 1 });
    expect(p.listening.pending()).toHaveLength(1);
    await service.chat(request);
    expect(create).toHaveBeenCalledTimes(2);
    expect(p.store.review(card.publicId)).toBeNull();
  });
  it("rejects malformed or empty provider metadata as a recoverable reply", () => {
    for (const response of ["{}", "null", "[]", '{"content":"","activities":[],"respondedToMessageIds":[]}', '{"content":"text","activities":[{"cardId":"x","activityType":"invented","exerciseType":null}],"respondedToMessageIds":[]}']) {
      expect(() => parseHomeworkReply(response)).toThrow("TUTOR_REPLY_INCOMPLETE");
    }
  });
});
