import type Database from "better-sqlite3";

export const migrateDailyGoals = (db: Database.Database) => db.exec(`
  CREATE TABLE daily_goal_settings (
    local_day TEXT PRIMARY KEY,
    settings TEXT NOT NULL CHECK(json_valid(settings))
  );
  CREATE TABLE daily_goal_events (
    kind TEXT NOT NULL CHECK(kind IN ('listen', 'recall', 'tutor')),
    source_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    local_day TEXT NOT NULL,
    language TEXT NOT NULL,
    PRIMARY KEY(kind, source_id)
  );
  CREATE INDEX daily_goal_events_day ON daily_goal_events(local_day, kind);
`);
