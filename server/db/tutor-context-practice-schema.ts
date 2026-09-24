import type Database from "better-sqlite3";

export const migrateTutorContextPractice = (db: Database.Database) => db.exec(`
  CREATE TABLE tutor_context_attempts (
    start_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    assistant_message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    language_code TEXT NOT NULL REFERENCES languages(code),
    target_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    context_id TEXT NOT NULL,
    quote TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('independent', 'assisted', 'not_used')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_message_id, target_key)
  );
  CREATE INDEX idx_tutor_context_attempts_target ON tutor_context_attempts(language_code, target_key, created_at);
  CREATE INDEX idx_tutor_context_attempts_session ON tutor_context_attempts(start_message_id, target_id);
`);
