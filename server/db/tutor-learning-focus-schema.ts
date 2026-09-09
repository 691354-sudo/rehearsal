import type Database from "better-sqlite3";

export const migrateTutorLearningFocus = (db: Database.Database) => db.exec(`
  CREATE TABLE tutor_learning_focus (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    language_code TEXT NOT NULL REFERENCES languages(code),
    topic_key TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT NOT NULL,
    dismissed_through_id INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(language_code, topic_key)
  );
  CREATE TABLE tutor_learning_focus_evidence (
    focus_id INTEGER NOT NULL REFERENCES tutor_learning_focus(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    quote TEXT NOT NULL,
    PRIMARY KEY(focus_id, message_id)
  );
`);
