import type Database from "better-sqlite3";

// Keep event history after card/chat deletion. Public IDs are immutable references,
// deliberately without cascading foreign keys; exports mark missing cards.
export const migrateLearningPilot = (db: Database.Database) => db.exec(`
  CREATE TABLE pilot_events (
    event_id TEXT PRIMARY KEY,
    language TEXT NOT NULL CHECK (language = 'en'),
    kind TEXT NOT NULL,
    card_id TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    app_version TEXT NOT NULL,
    experiment_version TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX pilot_events_period ON pilot_events(language, created_at, kind);
  CREATE TABLE pilot_listens (
    appearance_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE REFERENCES pilot_events(event_id),
    card_id TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    listen_count_after INTEGER NOT NULL,
    became_eligible INTEGER NOT NULL
  );
  CREATE INDEX pilot_listens_card ON pilot_listens(card_id, completed_at);
  CREATE TABLE pilot_card_progress (
    card_id TEXT PRIMARY KEY,
    listen_count INTEGER NOT NULL DEFAULT 0,
    recall_eligible_at TEXT,
    last_listen_at TEXT
  );
  CREATE TABLE pilot_priority_requests (
    request_id TEXT PRIMARY KEY REFERENCES pilot_events(event_id),
    card_id TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'cancelled')),
    resolved_at TEXT,
    cancelled_at TEXT,
    homework_id TEXT,
    assigned INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX pilot_priority_pending ON pilot_priority_requests(card_id)
    WHERE status = 'pending';
  CREATE INDEX pilot_priority_fifo ON pilot_priority_requests(status, assigned, requested_at, request_id);
  CREATE TRIGGER pilot_preference_unlike AFTER UPDATE OF preference ON items
    WHEN old.preference = 'like' AND new.preference != 'like' AND new.language_code = 'en'
    BEGIN
      UPDATE pilot_priority_requests SET status = 'cancelled',
        cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), assigned = 0
        WHERE card_id = new.public_id AND status = 'pending' AND NOT EXISTS (
          SELECT 1 FROM pilot_tutor_activities a WHERE a.card_id = pilot_priority_requests.card_id
            AND a.homework_id = pilot_priority_requests.homework_id);
    END;
  CREATE TABLE pilot_homework (
    homework_id TEXT PRIMARY KEY,
    tutor_chat_id TEXT NOT NULL,
    language TEXT NOT NULL CHECK (language = 'en'),
    started_at TEXT NOT NULL,
    status TEXT NOT NULL,
    app_version TEXT NOT NULL,
    experiment_version TEXT NOT NULL,
    plan TEXT NOT NULL,
    state TEXT NOT NULL
  );
  CREATE UNIQUE INDEX pilot_homework_active ON pilot_homework(tutor_chat_id)
    WHERE status IN ('recall_in_progress', 'tutor_in_progress', 'awaiting_feedback');
  CREATE INDEX pilot_homework_period ON pilot_homework(language, started_at);
  CREATE TABLE pilot_attempts (
    attempt_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    homework_id TEXT,
    shown_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rated_at TEXT,
    local_day TEXT NOT NULL,
    timezone TEXT NOT NULL,
    queue_reason TEXT NOT NULL,
    settings_snapshot TEXT NOT NULL,
    last_listen_at TEXT,
    app_version TEXT NOT NULL,
    experiment_version TEXT NOT NULL,
    submission TEXT,
    result TEXT
  );
  CREATE INDEX pilot_attempts_card ON pilot_attempts(card_id, rated_at);
  CREATE INDEX pilot_attempts_homework ON pilot_attempts(homework_id, card_id, rated_at);
  CREATE INDEX pilot_attempts_daily ON pilot_attempts(local_day, queue_reason, rated_at);
  CREATE TABLE pilot_time_intervals (
    event_id TEXT PRIMARY KEY REFERENCES pilot_events(event_id),
    homework_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    measurement_lost INTEGER NOT NULL
  );
  CREATE TABLE pilot_tutor_sessions (
    homework_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    completed_at TEXT,
    context TEXT NOT NULL
  );
  CREATE TABLE pilot_tutor_activities (
    homework_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    exercise_type TEXT,
    message_id INTEGER NOT NULL,
    user_response_message_id INTEGER,
    user_response_at TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (homework_id, card_id, activity_type, message_id)
  );
  CREATE TABLE pilot_tutor_user_messages (
    message_id INTEGER PRIMARY KEY,
    homework_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE pilot_feedback (
    homework_id TEXT PRIMARY KEY,
    submitted_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE pilot_participants (
    participant_id TEXT PRIMARY KEY,
    language TEXT NOT NULL CHECK (language = 'en'),
    native_language TEXT NOT NULL DEFAULT 'ru',
    started_at TEXT NOT NULL,
    scheduled_end_at TEXT NOT NULL,
    ended_at TEXT,
    timezone TEXT NOT NULL,
    app_version TEXT NOT NULL,
    experiment_version TEXT NOT NULL
  );
  CREATE UNIQUE INDEX pilot_participant_active ON pilot_participants(language) WHERE ended_at IS NULL;
  CREATE TABLE pilot_snapshots (
    participant_id TEXT NOT NULL REFERENCES pilot_participants(participant_id),
    snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('start', 'end')),
    snapshot_at TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (participant_id, snapshot_kind)
  );
`);
