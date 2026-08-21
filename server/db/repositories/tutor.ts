import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode } from "../../types.js";
import { makeThreadTitle } from "./shared.js";

export type TutorThreadRow = {
  id: number;
  public_id: string;
  language_code: LanguageCode;
  title: string;
  created_at: string;
  updated_at: string;
};

export class TutorRepository {
  constructor(private readonly db: RehearsalDatabase) {}

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

  addMessage(threadId: number, role: "user" | "assistant" | "tool", content: string, metadata = {}) {
    this.db.prepare(
      "INSERT INTO chat_messages(thread_id, role, content, metadata) VALUES (?, ?, ?, ?)",
    ).run(threadId, role, content, JSON.stringify(metadata));
    this.db.prepare(
      "UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(threadId);
  }

  getMessages(threadId: number, limit = 30) {
    return this.db.prepare(
      `SELECT role, content FROM (
       SELECT id, role, content FROM chat_messages
         WHERE thread_id = ? AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?
       ) ORDER BY id`,
    ).all(threadId, limit) as Array<{ role: "user" | "assistant"; content: string }>;
  }

  deleteThread(publicId: string) {
    return this.db.prepare("DELETE FROM chat_threads WHERE public_id = ?").run(publicId).changes > 0;
  }
}
