import type { TutorFeedback } from "../../../contracts/tutor-feedback.js";
import type { RehearsalDatabase } from "../database.js";

type FeedbackRow = TutorFeedback & { messageId: number; threadId: string };
type ContextMessage = {
  messageId: number; role: "user" | "assistant" | "tool"; content: string;
  clientMessageId: string | null; createdAt: string; metadata: Record<string, unknown>;
};
export type TutorFeedbackContext = {
  thread: { publicId: string; language: string; title: string; createdAt: string; updatedAt: string };
  messages: ContextMessage[];
  homework: Array<Record<string, unknown>>;
};

const feedbackColumns = `message_id AS messageId, thread_public_id AS threadId, text,
  created_at AS createdAt, updated_at AS updatedAt`;

export class TutorFeedbackRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  isAssistant(threadId: string, messageId: number) {
    return Boolean(this.db.prepare(`SELECT 1 FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
      WHERE t.public_id = ? AND m.id = ? AND m.role = 'assistant'`).get(threadId, messageId));
  }

  forThread(threadId: string) {
    const rows = this.db.prepare(`SELECT ${feedbackColumns} FROM tutor_message_feedback
      WHERE thread_public_id = ? ORDER BY message_id`).all(threadId) as FeedbackRow[];
    return new Map(rows.map(({ messageId, threadId: _, ...feedback }) => [messageId, feedback]));
  }

  save(threadId: string, messageId: number, text: string): TutorFeedback | null {
    return this.db.transaction(() => {
      if (!this.isAssistant(threadId, messageId)) return null;
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO tutor_message_feedback(message_id, thread_public_id, text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET text = excluded.text,
        updated_at = CASE WHEN text = excluded.text THEN updated_at ELSE excluded.updated_at END`)
        .run(messageId, threadId, text, now, now);
      return this.forThread(threadId).get(messageId)!;
    })();
  }

  remove(threadId: string, messageId: number) {
    return this.db.transaction(() => {
      if (!this.isAssistant(threadId, messageId)) return false;
      this.db.prepare("DELETE FROM tutor_message_feedback WHERE message_id = ? AND thread_public_id = ?")
        .run(messageId, threadId);
      return true;
    })();
  }

  context(threadId: string): TutorFeedbackContext | null {
    const thread = this.db.prepare(`SELECT public_id AS publicId, language_code AS language, title,
      created_at AS createdAt, updated_at AS updatedAt FROM chat_threads WHERE public_id = ?`)
      .get(threadId) as TutorFeedbackContext["thread"] | undefined;
    if (!thread) return null;
    const rows = this.db.prepare(`SELECT m.id AS messageId, m.role, m.content, m.metadata,
      m.client_message_id AS clientMessageId, m.created_at AS createdAt FROM chat_messages m
      JOIN chat_threads t ON t.id = m.thread_id WHERE t.public_id = ? ORDER BY m.id`)
      .all(threadId) as Array<Omit<ContextMessage, "metadata"> & { metadata: string }>;
    const homework = this.db.prepare(`SELECT h.*, s.context AS tutor_context FROM pilot_homework h
      LEFT JOIN pilot_tutor_sessions s ON s.homework_id = h.homework_id
      WHERE h.tutor_chat_id = ? ORDER BY h.started_at, h.homework_id`).all(threadId) as Array<Record<string, unknown>>;
    return { thread, messages: rows.map(({ metadata, ...message }) => ({ ...message, metadata: JSON.parse(metadata) })), homework };
  }

  // Called inside the chat deletion transaction, before its messages can cascade away.
  archive(threadId: string) {
    if (!this.forThread(threadId).size) return;
    const snapshot = this.context(threadId);
    if (!snapshot) return;
    this.db.prepare(`INSERT INTO tutor_feedback_archives(thread_public_id, snapshot, archived_at)
      VALUES (?, ?, ?)`).run(threadId, JSON.stringify(snapshot), new Date().toISOString());
  }

  export() {
    return this.db.transaction(() => {
      const feedback = this.db.prepare(`SELECT ${feedbackColumns} FROM tutor_message_feedback
        ORDER BY created_at, message_id`).all() as FeedbackRow[];
      const conversations = [...new Set(feedback.map((row) => row.threadId))].map((threadId) => {
        const archived = this.db.prepare(`SELECT snapshot, archived_at AS archivedAt
          FROM tutor_feedback_archives WHERE thread_public_id = ?`).get(threadId) as {
            snapshot: string; archivedAt: string;
          } | undefined;
        const context = archived ? JSON.parse(archived.snapshot) as TutorFeedbackContext : this.context(threadId);
        if (!context) throw new Error(`Feedback context missing for ${threadId}`);
        return { ...context, archivedAt: archived?.archivedAt ?? null,
          feedback: feedback.filter((row) => row.threadId === threadId).map((row) => {
            const message = context.messages.find((message) => message.messageId === row.messageId);
            return { ...row, diagnosticsAvailable: Boolean(message?.metadata.diagnostics) };
          }) };
      }).sort((a, b) => a.thread.createdAt.localeCompare(b.thread.createdAt) || a.thread.publicId.localeCompare(b.thread.publicId));
      return { version: 1, conversations };
    })();
  }
}
