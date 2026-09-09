import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("Homework conversation boundaries", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });

  const legacySessions = () => {
    const p = context.repository.pilot;
    const first = p.homework.create({ homeworkId: randomUUID(), requestedMinutes: 2, timezone: "Europe/Riga" }, "2026-09-08T08:00:00Z");
    p.homework.cancel(first.homeworkId);
    const second = p.homework.create({ homeworkId: randomUUID(), tutorChatId: first.tutorChatId,
      requestedMinutes: 2, timezone: "Europe/Riga" }, "2026-09-09T08:00:00Z");
    const thread = context.repository.tutor.getThread(first.tutorChatId)!;
    context.repository.tutor.addMessage(thread.id, "user", "Unrelated chat before Homework");
    context.repository.tutor.addMessage(thread.id, "user", "Yesterday phrase", { homeworkId: first.homeworkId }, randomUUID());
    context.repository.tutor.addMessage(thread.id, "assistant", "Yesterday correction", { homeworkId: first.homeworkId });
    context.repository.tutor.addMessage(thread.id, "user", "Today phrase", { homeworkId: second.homeworkId }, randomUUID());
    context.repository.tutor.addMessage(thread.id, "assistant", "Today correction", { homeworkId: second.homeworkId });
    return { first, second };
  };

  it("loads old shared chats by Homework, defaults to the latest, and rejects another chat's id", async () => {
    const { first, second } = legacySessions();
    const app = await buildApp(context.repository);
    for (const [suffix, expected, homeworkId] of [
      [`?homeworkId=${first.homeworkId}`, ["Yesterday phrase", "Yesterday correction"], first.homeworkId],
      [`?homeworkId=${second.homeworkId}`, ["Today phrase", "Today correction"], second.homeworkId],
      ["", ["Today phrase", "Today correction"], second.homeworkId],
    ] as const) {
      const response = await app.inject({ method: "GET", url: `/api/chat/${first.tutorChatId}/messages${suffix}` });
      expect(response.statusCode).toBe(200);
      expect(response.json().homeworkId).toBe(homeworkId);
      expect(response.json().messages.map((message: { content: string }) => message.content)).toEqual(expected);
      expect(response.json().messages[0].clientMessageId).toBeTruthy();
    }
    const other = context.repository.tutor.getOrCreateThread(undefined, "en");
    const mismatch = await app.inject({ method: "GET", url: `/api/chat/${other.publicId}/messages?homeworkId=${first.homeworkId}` });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).toBe("HOMEWORK_CHAT_MISMATCH");
    await app.close();
  });

  it("prepares cards only from the selected Homework, including after it has ended", async () => {
    const { first, second } = legacySessions();
    const openai = new OpenAIService(context.repository);
    const review = vi.spyOn(openai, "reviewConversation").mockResolvedValue({ batch: { candidates: [] } } as never);
    const app = await buildApp(context.repository, { openai });
    for (const [id, expected] of [[first.homeworkId, "Yesterday"], [second.homeworkId, "Today"]]) {
      const response = await app.inject({ method: "POST", url: `/api/chat/${first.tutorChatId}/review?homeworkId=${id}` });
      expect(response.statusCode).toBe(201);
      expect(review.mock.lastCall?.[0].messages.map((message) => message.content)).toEqual([`${expected} phrase`, `${expected} correction`]);
    }
    const other = context.repository.tutor.getOrCreateThread(undefined, "en");
    expect((await app.inject({ method: "POST", url: `/api/chat/${other.publicId}/review?homeworkId=${first.homeworkId}` })).statusCode).toBe(409);
    expect(review).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
