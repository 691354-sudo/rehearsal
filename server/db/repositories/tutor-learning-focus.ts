import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode } from "../../types.js";

export type LearningFocus = { key: string; title: string; detail: string; occurrences: number; examples: string[] };

export class TutorLearningFocusRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  evidenceFor(threadId: number, throughMessageId: number, quote: string) {
    return this.db.prepare(`SELECT id FROM (SELECT id, role, content FROM chat_messages
      WHERE thread_id = ? AND id <= ? ORDER BY id DESC LIMIT 100)
      WHERE role = 'user' AND instr(content, ?) > 0 ORDER BY id DESC LIMIT 3`)
      .all(threadId, throughMessageId, quote) as Array<{ id: number }>;
  }

  list(language: LanguageCode, includeCandidates = false): LearningFocus[] {
    const rows = this.db.prepare(`SELECT f.id, f.topic_key AS key, f.title, f.detail, COUNT(e.message_id) AS occurrences
      FROM tutor_learning_focus f JOIN tutor_learning_focus_evidence e ON e.focus_id = f.id
      WHERE f.language_code = ? GROUP BY f.id HAVING COUNT(e.message_id) >= ?
      ORDER BY occurrences DESC, f.updated_at DESC, f.id DESC LIMIT 100`).all(language, includeCandidates ? 1 : 2) as Array<Omit<LearningFocus, "examples"> & { id: number }>;
    return rows.map(({ id, ...row }) => ({ ...row, examples: (this.db.prepare(`SELECT quote FROM tutor_learning_focus_evidence
      WHERE focus_id = ? ORDER BY message_id DESC LIMIT 2`).all(id) as Array<{ quote: string }>).map((entry) => entry.quote) }));
  }

  record(language: LanguageCode, messageId: number, input: { key: string; title: string; detail: string; quote: string }) {
    return this.db.transaction(() => {
      const message = this.db.prepare(`SELECT m.content FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
        WHERE m.id = ? AND m.role = 'user' AND t.language_code = ?`).get(messageId, language) as { content: string } | undefined;
      if (!message || !message.content.includes(input.quote)) return { error: "Evidence must quote the current learner message exactly." };
      const key = input.key.normalize("NFC").toLocaleLowerCase().trim();
      const existing = this.db.prepare(`SELECT id, dismissed_through_id FROM tutor_learning_focus
        WHERE language_code = ? AND topic_key = ?`).get(language, key) as { id: number; dismissed_through_id: number } | undefined;
      if (existing && messageId <= existing.dismissed_through_id) return { status: "dismissed" };
      if (!existing) {
        const count = this.db.prepare("SELECT COUNT(*) AS n FROM tutor_learning_focus WHERE language_code = ? AND title <> ''").get(language) as { n: number };
        if (count.n >= 100) return { error: "Learning focus limit reached." };
      }
      this.db.prepare(`INSERT INTO tutor_learning_focus(language_code, topic_key, title, detail) VALUES (?, ?, ?, ?)
        ON CONFLICT(language_code, topic_key) DO UPDATE SET title = excluded.title, detail = excluded.detail, updated_at = CURRENT_TIMESTAMP`)
        .run(language, key, input.title, input.detail);
      const { id } = this.db.prepare("SELECT id FROM tutor_learning_focus WHERE language_code = ? AND topic_key = ?")
        .get(language, key) as { id: number };
      this.db.prepare("INSERT OR IGNORE INTO tutor_learning_focus_evidence(focus_id, message_id, quote) VALUES (?, ?, ?)")
        .run(id, messageId, input.quote);
      const { n } = this.db.prepare("SELECT COUNT(*) AS n FROM tutor_learning_focus_evidence WHERE focus_id = ?").get(id) as { n: number };
      return { status: n >= 2 ? "saved" : "observed_once", key, occurrences: n };
    }).immediate();
  }

  remove(language: LanguageCode, key: string) {
    return this.db.transaction(() => {
      const focus = this.db.prepare("SELECT id FROM tutor_learning_focus WHERE language_code = ? AND topic_key = ?")
        .get(language, key.normalize("NFC").toLocaleLowerCase().trim()) as { id: number } | undefined;
      if (!focus) return { removed: false };
      this.db.prepare("DELETE FROM tutor_learning_focus_evidence WHERE focus_id = ?").run(focus.id);
      this.db.prepare(`UPDATE tutor_learning_focus SET title = '', detail = '',
        dismissed_through_id = (SELECT COALESCE(MAX(id), 0) FROM chat_messages) WHERE id = ?`).run(focus.id);
      return { removed: true };
    }).immediate();
  }
}
