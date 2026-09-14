import type Database from "better-sqlite3";

export const migrateTutorFeedback = (db: Database.Database) => db.exec(`
  CREATE TABLE tutor_message_feedback (
    message_id INTEGER PRIMARY KEY,
    thread_public_id TEXT NOT NULL,
    text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 4000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX tutor_feedback_thread ON tutor_message_feedback(thread_public_id, message_id);
  CREATE TABLE tutor_feedback_archives (
    thread_public_id TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
    archived_at TEXT NOT NULL
  );
`);
