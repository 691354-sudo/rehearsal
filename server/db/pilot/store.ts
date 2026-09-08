import { randomUUID } from "node:crypto";
import { pilotDefaults, type Homework, type PilotSettings } from "../../../contracts/learning-pilot.js";
import type { RehearsalDatabase } from "../database.js";
import type { PracticeRepository } from "../repositories/practice.js";
import { mapItem, mapReviewState, type ItemRow, type ReviewStateRow } from "../repositories/shared.js";

export class PilotError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}
export const localDay = (date: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(date));
export type PilotEventRow = {
  event_id: string; kind: string; card_id: string | null; occurred_at: string;
  created_at: string; app_version: string; experiment_version: string; data: string;
};
export type HomeworkRow = {
  homework_id: string; tutor_chat_id: string; started_at: string; status: Homework["status"];
  plan: string; state: string; app_version: string; experiment_version: string;
};

export class PilotStore {
  constructor(readonly db: RehearsalDatabase, readonly practice: PracticeRepository) {}

  settings(): PilotSettings {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'learning_pilot'")
      .get() as { value: string } | undefined;
    const settings = { ...pilotDefaults, ...(row ? JSON.parse(row.value) : {}) } as typeof pilotDefaults;
    const scheduler = structuredClone(this.practice.getSettings());
    const uniform = { ...scheduler.presets.neutral, requestRetention: settings.desiredRetention };
    scheduler.presets = { like: uniform, neutral: uniform, dislike: uniform };
    return { ...settings, scheduler };
  }

  identity() {
    const existing = this.db.prepare("SELECT value FROM app_settings WHERE key = 'pilot_user_id'").get() as { value: string } | undefined;
    if (existing) return JSON.parse(existing.value) as string;
    this.db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('pilot_user_id', ?)")
      .run(JSON.stringify(randomUUID()));
    return JSON.parse((this.db.prepare("SELECT value FROM app_settings WHERE key = 'pilot_user_id'")
      .get() as { value: string }).value) as string;
  }

  versions() {
    return { appVersion: process.env.APP_VERSION || "0.1.0+echo-pilot-v1", experimentVersion: this.settings().experimentVersion };
  }

  timezone(preferred?: string) {
    const participant = this.db.prepare("SELECT timezone FROM pilot_participants WHERE ended_at IS NULL LIMIT 1")
      .get() as { timezone: string } | undefined;
    if (participant) return participant.timezone;
    const saved = this.db.prepare("SELECT value FROM app_settings WHERE key = 'pilot_timezone'")
      .get() as { value: string } | undefined;
    if (saved) return JSON.parse(saved.value) as string;
    if (preferred) {
      localDay(new Date().toISOString(), preferred);
      this.db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('pilot_timezone', ?)")
        .run(JSON.stringify(preferred));
    }
    return preferred ?? "UTC";
  }

  item(cardId: string) {
    const row = this.db.prepare("SELECT * FROM items WHERE public_id = ? AND language_code = 'en'")
      .get(cardId) as ItemRow | undefined;
    if (!row) throw new PilotError("PILOT_CARD_NOT_FOUND", 404);
    return mapItem(row);
  }

  review(cardId: string) {
    return mapReviewState(this.db.prepare(`SELECT r.* FROM review_state r
      JOIN items i ON i.id = r.item_id WHERE i.public_id = ? AND i.language_code = 'en'`)
      .get(cardId) as ReviewStateRow | undefined) ?? null;
  }

  progress(cardId: string) {
    const row = this.db.prepare(`SELECT listen_count, recall_eligible_at, last_listen_at
      FROM pilot_card_progress WHERE card_id = ?`).get(cardId) as {
        listen_count: number; recall_eligible_at: string | null; last_listen_at: string | null;
      } | undefined;
    const reviews = this.db.prepare(`SELECT COUNT(*) AS recalls,
      COALESCE(SUM(a.verdict IN ('hard', 'good', 'easy')), 0) AS successes
      FROM attempts a JOIN items i ON i.id = a.item_id
      WHERE i.public_id = ? AND i.language_code = 'en' AND a.mode = 'recall'`).get(cardId) as {
        recalls: number; successes: number;
      };
    return {
      listenCount: row?.listen_count ?? 0,
      recallEligibleAt: row?.recall_eligible_at ?? null,
      lastListenAt: row?.last_listen_at ?? null,
      hasRecallHistory: reviews.recalls > 0,
      successfulRecallCount: reviews.successes,
      recalls: reviews.recalls,
    };
  }

  event(eventId: string) {
    return this.db.prepare("SELECT * FROM pilot_events WHERE event_id = ?").get(eventId) as PilotEventRow | undefined;
  }

  addEvent(eventId: string, kind: string, cardId: string | null, occurredAt: string,
    data: unknown, now: string, experimentVersion = this.settings().experimentVersion) {
    this.identity();
    this.db.prepare(`INSERT INTO pilot_events(event_id, language, kind, card_id, occurred_at,
      created_at, app_version, experiment_version, data) VALUES (?, 'en', ?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, kind, cardId, occurredAt, now, this.versions().appVersion, experimentVersion, JSON.stringify(data));
  }

  homework(id: string): Homework {
    const row = this.db.prepare("SELECT * FROM pilot_homework WHERE homework_id = ?")
      .get(id) as HomeworkRow | undefined;
    if (!row) throw new PilotError("HOMEWORK_NOT_FOUND", 404);
    const feedback = this.db.prepare("SELECT data FROM pilot_feedback WHERE homework_id = ?")
      .get(id) as { data: string } | undefined;
    return { ...JSON.parse(row.plan), ...JSON.parse(row.state), homeworkId: id, tutorChatId: row.tutor_chat_id,
      timezone: JSON.parse(row.plan).timezone ?? this.timezone(),
      language: "en", startedAt: row.started_at, status: row.status,
      feedback: feedback ? JSON.parse(feedback.data) : null };
  }

  updateHomework(id: string, patch: Partial<Homework>) {
    const row = this.db.prepare("SELECT state, status FROM pilot_homework WHERE homework_id = ?")
      .get(id) as Pick<HomeworkRow, "state" | "status"> | undefined;
    if (!row) throw new PilotError("HOMEWORK_NOT_FOUND", 404);
    this.db.prepare("UPDATE pilot_homework SET state = ?, status = ? WHERE homework_id = ?")
      .run(JSON.stringify({ ...JSON.parse(row.state), ...patch }), patch.status ?? row.status, id);
    return this.homework(id);
  }
}
