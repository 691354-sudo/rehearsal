import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode } from "../../types.js";
import { makeThreadTitle } from "./shared.js";
import { TutorLearningFocusRepository } from "./tutor-learning-focus.js";

export type TutorThreadRow = {
  id: number;
  public_id: string;
  language_code: LanguageCode;
  title: string;
  created_at: string;
  updated_at: string;
};

type ClientMessageRow = {
  message_id: number;
  thread_id: number;
  thread_public_id: string;
  language_code: LanguageCode;
  content: string;
  homework_id: string | null;
};

export class TutorRepository {
  readonly learningFocus: TutorLearningFocusRepository;

  constructor(private readonly db: RehearsalDatabase) {
    this.learningFocus = new TutorLearningFocusRepository(db);
  }

  setMode(threadId: number, messageId: number, mode: "chat" | "guided", restart = false) {
    if (!restart && this.getMode(threadId)?.mode === mode) return;
    this.db.prepare(`UPDATE chat_messages SET metadata = json_set(metadata, '$.tutorMode', ?)
      WHERE id = ? AND thread_id = ? AND role = 'user'`).run(mode, messageId, threadId);
  }

  getMode(threadId: number) {
    return this.db.prepare(`SELECT id AS messageId, json_extract(metadata, '$.tutorMode') AS mode
      FROM chat_messages WHERE thread_id = ? AND role = 'user'
      AND json_extract(metadata, '$.tutorMode') IN ('chat', 'guided') ORDER BY id DESC LIMIT 1`)
      .get(threadId) as { messageId: number; mode: "chat" | "guided" } | undefined;
  }

  guidedMessages(threadId: number, fromMessageId: number) {
    return this.db.prepare(`SELECT role, content FROM chat_messages WHERE thread_id = ? AND id >= ?
      AND role IN ('user', 'assistant') ORDER BY id LIMIT 100`).all(threadId, fromMessageId) as Array<{ role: "user" | "assistant"; content: string }>;
  }

  getOrCreateThread(publicId: string | undefined, language: LanguageCode) {
    if (publicId) {
      const found = this.db.prepare(
        "SELECT id, public_id, language_code FROM chat_threads WHERE public_id = ?",
      ).get(publicId) as { id: number; public_id: string; language_code: LanguageCode } | undefined;
      if (found && found.language_code !== language) throw new Error("THREAD_LANGUAGE_MISMATCH");
      if (found) return { id: found.id, publicId: found.public_id };
    }
    const nextPublicId = randomUUID();
    const result = this.db.prepare(
      "INSERT INTO chat_threads(public_id, language_code) VALUES (?, ?)",
    ).run(nextPublicId, language);
    return { id: Number(result.lastInsertRowid), publicId: nextPublicId };
  }

  getThread(publicId: string) {
    return this.db.prepare(
      "SELECT id, public_id, language_code, title, created_at, updated_at FROM chat_threads WHERE public_id = ?",
    ).get(publicId) as TutorThreadRow | undefined;
  }

  ensureThreadTitle(threadId: number, message: string) {
    const row = this.db.prepare(
      "SELECT title FROM chat_threads WHERE id = ?",
    ).get(threadId) as { title: string } | undefined;
    if (!row || row.title !== "Tutor chat") return row?.title || "New conversation";
    const title = makeThreadTitle(message);
    this.db.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(title, threadId);
    return title;
  }

  listThreads(language: LanguageCode, limit = 50) {
    const rows = this.db.prepare(
      `SELECT t.id, t.public_id, t.title, t.created_at, t.updated_at,
              COUNT(m.id) AS message_count,
              (SELECT first_message.content FROM chat_messages first_message
               WHERE first_message.thread_id = t.id AND first_message.role = 'user'
               ORDER BY first_message.id LIMIT 1) AS first_message
       FROM chat_threads t
       LEFT JOIN chat_messages m ON m.thread_id = t.id AND m.role IN ('user', 'assistant')
       WHERE t.language_code = ?
       GROUP BY t.id
       HAVING COUNT(m.id) > 0
       ORDER BY datetime(t.updated_at) DESC, t.id DESC
       LIMIT ?`,
    ).all(language, limit) as Array<{
      id: number;
      public_id: string;
      title: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      first_message: string | null;
    }>;

    return rows.map((row) => ({
      publicId: row.public_id,
      title: row.title === "Tutor chat" && row.first_message
        ? this.ensureThreadTitle(row.id, row.first_message)
        : row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
    }));
  }

  addMessage(threadId: number, role: "user" | "assistant" | "tool", content: string, metadata = {}, clientMessageId?: string) {
    const result = this.db.prepare(
      "INSERT INTO chat_messages(thread_id, role, content, client_message_id, metadata) VALUES (?, ?, ?, ?, ?)",
    ).run(threadId, role, content, clientMessageId || null, JSON.stringify(metadata));
    this.db.prepare(
      "UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(threadId);
    return Number(result.lastInsertRowid);
  }

  getOrCreateClientMessage(input: {
    clientMessageId: string;
    content: string;
    language: LanguageCode;
    threadPublicId?: string;
    homeworkId?: string;
  }) {
    return this.db.transaction(() => {
      const existing = this.getClientMessage(input.clientMessageId);
      if (existing) {
        if (existing.content !== input.content || existing.language_code !== input.language
          || (input.threadPublicId && existing.thread_public_id !== input.threadPublicId)) {
          throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
        }
        return existing;
      }
      const thread = this.getOrCreateThread(input.threadPublicId, input.language);
      const messageId = this.addMessage(thread.id, "user", input.content,
        input.homeworkId ? { homeworkId: input.homeworkId } : {}, input.clientMessageId);
      this.ensureThreadTitle(thread.id, input.content);
      return {
        message_id: messageId,
        thread_id: thread.id,
        thread_public_id: thread.publicId,
        language_code: input.language,
        content: input.content,
        homework_id: input.homeworkId ?? null,
      } satisfies ClientMessageRow;
    })();
  }

  getCompletedClientExchange(clientMessageId: string) {
    const message = this.getClientMessage(clientMessageId);
    if (!message) return null;
    const assistant = this.db.prepare(
      `SELECT content, metadata FROM chat_messages
       WHERE thread_id = ? AND id > ? AND role = 'assistant'
         AND json_extract(metadata, '$.clientMessageId') = ? ORDER BY id LIMIT 1`,
    ).get(message.thread_id, message.message_id, clientMessageId) as { content: string; metadata: string } | undefined;
    if (!assistant) return null;
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(assistant.metadata) as Record<string, unknown>; } catch { /* legacy metadata */ }
    return {
      threadId: message.thread_public_id,
      content: assistant.content,
      mode: metadata.mode === "setup" ? "setup" as const : "openai" as const,
      toolCalls: [],
      metadata,
    };
  }

  getMessages(threadId: number, limit = 30, includeMessageIds = false, homeworkId?: string) {
    const messages = this.db.prepare(
      `SELECT role, content, client_message_id AS clientMessageId FROM (
       SELECT id, role, content, client_message_id FROM chat_messages
         WHERE thread_id = ? AND role IN ('user', 'assistant')
           ${homeworkId ? `AND (json_extract(metadata, '$.homeworkId') = ?
             OR client_message_id = ? OR json_extract(metadata, '$.clientMessageId') = ?)` : ""} ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
    ).all(threadId, ...(homeworkId ? [homeworkId, homeworkId, homeworkId] : []), limit) as Array<{ role: "user" | "assistant"; content: string; clientMessageId: string | null }>;
    return messages.map(({ clientMessageId, ...message }) => includeMessageIds && clientMessageId
      ? { ...message, clientMessageId } : message);
  }

  deleteThread(publicId: string) {
    return this.db.prepare("DELETE FROM chat_threads WHERE public_id = ?").run(publicId).changes > 0;
  }

  private getClientMessage(clientMessageId: string) {
    return this.db.prepare(
      `SELECT m.id AS message_id, t.id AS thread_id, t.public_id AS thread_public_id,
              t.language_code, m.content, json_extract(m.metadata, '$.homeworkId') AS homework_id
       FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
       WHERE m.client_message_id = ? AND m.role = 'user'`,
    ).get(clientMessageId) as ClientMessageRow | undefined;
  }
}
