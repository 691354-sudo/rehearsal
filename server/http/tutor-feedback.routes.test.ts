import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("Tutor message feedback", () => {
  let context: ApiTestContext;
  let app: FastifyInstance;
  beforeEach(async () => { context = createApiTestContext(); app = await buildApp(context.repository); });
  afterEach(async () => { await app.close(); context.close(); });
  const thread = () => context.repository.tutor.getOrCreateThread(undefined, "en");
  const path = (threadId: string, messageId: number) => `/api/chat/${threadId}/messages/${messageId}/feedback`;

  it("edits one feedback record on a stable message ID, survives reopen, and deletes idempotently", async () => {
    const chat = thread();
    const first = context.repository.tutor.addMessage(chat.id, "assistant", "Same reply");
    const second = context.repository.tutor.addMessage(chat.id, "assistant", "Same reply");
    const request = { method: "PUT" as const, url: path(chat.publicId, second), payload: { text: "  Less formatting, please.  " } };
    const saved = await app.inject(request);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().feedback.text).toBe("Less formatting, please.");
    expect((await app.inject(request)).json()).toEqual(saved.json());
    const updated = await app.inject({ ...request, payload: { text: "Keep the short hints." } });
    expect(updated.json().feedback.createdAt).toBe(saved.json().feedback.createdAt);
    const history = (await app.inject({ method: "GET", url: `/api/chat/${chat.publicId}/messages` })).json().messages;
    expect(history).toEqual([
      { role: "assistant", content: "Same reply", messageId: first, feedback: null },
      { role: "assistant", content: "Same reply", messageId: second, feedback: updated.json().feedback },
    ]);
    await app.close(); context.reopen(); app = await buildApp(context.repository);
    expect(context.repository.tutor.feedback.forThread(chat.publicId).size).toBe(1);
    expect((await app.inject({ method: "DELETE", url: request.url })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: request.url })).statusCode).toBe(204);
    expect(context.repository.tutor.feedback.export().conversations).toEqual([]);
  });

  it("rejects empty/long feedback and messages outside the addressed chat or assistant role", async () => {
    const chat = thread();
    const other = thread();
    const user = context.repository.tutor.addMessage(chat.id, "user", "hello");
    const tool = context.repository.tutor.addMessage(chat.id, "tool", "[]");
    const assistant = context.repository.tutor.addMessage(chat.id, "assistant", "Hi");
    for (const text of ["   ", "x".repeat(4001)]) {
      expect((await app.inject({ method: "PUT", url: path(chat.publicId, assistant), payload: { text } })).statusCode).toBe(400);
    }
    for (const [threadId, messageId] of [[chat.publicId, user], [chat.publicId, tool], [other.publicId, assistant]] as const) {
      for (const method of ["PUT", "DELETE"] as const) {
        expect((await app.inject({ method, url: path(threadId, messageId), ...(method === "PUT" ? { payload: { text: "comment" } } : {}) })).statusCode).toBe(404);
      }
    }
    expect((await app.inject({ method: "PUT", url: path(chat.publicId, assistant), payload: { text: "я".repeat(4000) } })).statusCode).toBe(200);
  });

  it("archives the full chat once with exact tool results and Homework context, beyond the screen history limit", async () => {
    const chat = thread();
    const hw = context.repository.pilot.homework.create({ homeworkId: randomUUID(), tutorChatId: chat.publicId, requestedMinutes: 2, timezone: "Europe/Riga" });
    const first = context.repository.tutor.addMessage(chat.id, "assistant", "An older answer", { homeworkId: hw.homeworkId });
    context.repository.tutor.feedback.save(chat.publicId, first, "A useful example.");
    const tool = context.repository.tutor.addMessage(chat.id, "tool", JSON.stringify([{ cardId: "original", target: "Keep this wording." }]), { name: "search_library", arguments: { query: "wording", limit: 1 } });
    for (let i = 0; i < 220; i++) context.repository.tutor.addMessage(chat.id, i % 2 ? "assistant" : "user", `Later message ${i}`);
    const last = context.repository.tutor.addMessage(chat.id, "assistant", "Latest reply", { diagnostics: { toolMessageIds: [tool] } });
    context.repository.tutor.feedback.save(chat.publicId, last, "Explain the card selection.");
    const before = context.repository.tutor.feedback.export().conversations[0];
    expect(before.messages).toHaveLength(223);
    expect(before.feedback.map((row) => row.diagnosticsAvailable)).toEqual([false, true]);
    expect((await app.inject({ method: "DELETE", url: `/api/chat/${chat.publicId}` })).statusCode).toBe(204);
    const exported = context.repository.tutor.feedback.export().conversations[0];
    expect(exported.messages).toEqual(before.messages);
    expect(exported.feedback).toEqual(before.feedback);
    expect(exported.homework[0]).toMatchObject({ homework_id: hw.homeworkId, status: "cancelled" });
    expect(exported.archivedAt).toEqual(expect.any(String));
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM tutor_feedback_archives").get()).toEqual({ n: 1 });
    expect(context.repository.tutor.getThread(chat.publicId)).toBeUndefined();
    expect(context.repository.tutor.getMessages(chat.id, 500)).toEqual([]);
    expect(context.repository.pilot.homework.list()).toEqual([]);
    context.reopen();
    expect(context.repository.tutor.feedback.export().conversations[0]).toEqual(exported);
  });

  it("rolls back chat deletion and Homework cancellation when the archive cannot be saved", async () => {
    const chat = thread();
    const hw = context.repository.pilot.homework.create({ homeworkId: randomUUID(), tutorChatId: chat.publicId, requestedMinutes: 2, timezone: "Europe/Riga" });
    const messageId = context.repository.tutor.addMessage(chat.id, "assistant", "Keep this response.");
    context.repository.tutor.feedback.save(chat.publicId, messageId, "Keep this feedback.");
    context.db.exec(`CREATE TRIGGER reject_feedback_archive BEFORE INSERT ON tutor_feedback_archives
      BEGIN SELECT RAISE(ABORT, 'archive unavailable'); END;`);
    expect((await app.inject({ method: "DELETE", url: `/api/chat/${chat.publicId}` })).statusCode).toBe(500);
    expect(context.repository.tutor.getMessages(chat.id)).toHaveLength(1);
    expect(context.repository.pilot.homework.forChat(chat.publicId)?.status).toBe(hw.status);
    expect(context.repository.tutor.feedback.forThread(chat.publicId).get(messageId)?.text).toBe("Keep this feedback.");
  });
});
