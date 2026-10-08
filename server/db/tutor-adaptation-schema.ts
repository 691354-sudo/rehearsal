import type Database from "better-sqlite3";

export const migrateTutorAdaptation = (db: Database.Database) => db.exec(`
  CREATE TABLE tutor_learning_profiles (
    native_language TEXT NOT NULL,
    target_language TEXT NOT NULL REFERENCES languages(code),
    profile TEXT NOT NULL CHECK(json_valid(profile)),
    PRIMARY KEY(native_language, target_language)
  );
  CREATE TABLE tutor_adaptation_sessions (
    session_id TEXT PRIMARY KEY,
    native_language TEXT NOT NULL,
    target_language TEXT NOT NULL REFERENCES languages(code),
    session_number INTEGER NOT NULL,
    summary TEXT NOT NULL CHECK(json_valid(summary)),
    completed_at TEXT NOT NULL,
    UNIQUE(native_language, target_language, session_number)
  );
  CREATE TABLE tutor_adaptation_thread_settings (
    session_id TEXT PRIMARY KEY,
    interaction_mode TEXT NOT NULL CHECK(interaction_mode IN ('beginner', 'intermediate', 'advanced'))
  );
  CREATE TABLE tutor_adaptation_events (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    native_language TEXT NOT NULL,
    target_language TEXT NOT NULL REFERENCES languages(code),
    data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
    created_at TEXT NOT NULL
  );
  CREATE INDEX tutor_adaptation_event_period ON tutor_adaptation_events(created_at, kind);
`);
