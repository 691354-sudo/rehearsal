import type { PilotSettings, PilotAttemptGrade, PilotAttemptStart, QueueReason } from "../../../contracts/learning-pilot.js";
import { normalizeSchedulerSettings, type StoredReviewState } from "../../services/scheduler.js";
import { PilotQueue } from "./queue.js";
import { localDay, PilotError, PilotStore } from "./store.js";

export type AttemptRow = {
  attempt_id: string; card_id: string; homework_id: string | null; shown_at: string;
  created_at: string; rated_at: string | null; local_day: string; timezone: string;
  queue_reason: QueueReason; settings_snapshot: string; last_listen_at: string | null; app_version: string;
  experiment_version: string; submission: string | null; result: string | null;
};
export type AttemptResult = {
  publicId: string;
  schedule: ReturnType<PilotStore["practice"]["recordAttempt"]>["schedule"];
  fsrsStateBefore: StoredReviewState | null;
  fsrsStateAfter: StoredReviewState | null;
  successfulRecallCount: number;
};

export class PilotRecall {
  constructor(private readonly store: PilotStore, private readonly queue: PilotQueue) {}

  get(attemptId: string) {
    return this.store.db.prepare("SELECT * FROM pilot_attempts WHERE attempt_id = ?")
      .get(attemptId) as AttemptRow | undefined;
  }

  begin(input: PilotAttemptStart, now = new Date().toISOString()) {
    const { db } = this.store;
    return db.transaction(() => {
      const previous = this.get(input.attemptId);
      if (previous) {
        if (previous.card_id !== input.cardId || previous.homework_id !== (input.homeworkId ?? null)
          || previous.shown_at !== input.shownAt) throw new PilotError("ATTEMPT_ID_CONFLICT");
        return previous;
      }
      if (Date.parse(input.shownAt) > Date.parse(now) + 60_000) throw new PilotError("INVALID_SHOWN_TIME", 400);
      const eligible = this.queue.list({ cardId: input.cardId, homeworkId: input.homeworkId, timezone: input.timezone }, now)
        .find((card) => card.publicId === input.cardId);
      if (!eligible) throw new PilotError("CARD_NOT_AVAILABLE_FOR_RECALL");
      const settings = input.homeworkId ? this.store.homework(input.homeworkId).settingsSnapshot : this.store.settings();
      const timezone = this.store.timezone(input.timezone);
      this.store.identity();
      const last = db.prepare(`SELECT MAX(completed_at) AS at FROM pilot_listens
        WHERE card_id = ? AND julianday(completed_at) <= julianday(?)`).get(input.cardId, input.shownAt) as { at: string | null };
      db.prepare(`INSERT INTO pilot_attempts(attempt_id, card_id, homework_id, shown_at, created_at,
        local_day, timezone, queue_reason, settings_snapshot, last_listen_at, app_version, experiment_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.attemptId, input.cardId, input.homeworkId ?? null, input.shownAt, now,
          localDay(now, timezone), timezone, eligible.queueReason, JSON.stringify(settings), last.at,
          this.store.versions().appVersion, settings.experimentVersion);
      return this.get(input.attemptId)!;
    }).immediate();
  }

  grade(input: PilotAttemptGrade, now = new Date().toISOString()): AttemptResult {
    const { db } = this.store;
    return db.transaction(() => {
      const attempt = this.get(input.attemptId);
      if (!attempt) throw new PilotError("ATTEMPT_NOT_FOUND", 404);
      if (attempt.result) {
        if (attempt.submission !== JSON.stringify(input)) throw new PilotError("ATTEMPT_ID_CONFLICT");
        return JSON.parse(attempt.result) as AttemptResult;
      }
      const shown = Date.parse(attempt.shown_at);
      const revealed = Date.parse(input.revealedAt);
      const rated = Date.parse(input.ratedAt);
      if (revealed < shown || rated < revealed || rated > Date.parse(now) + 60_000
        || (input.responseTimeMs !== null && input.responseTimeMs > rated - shown + 1000)) {
        throw new PilotError("INVALID_ATTEMPT_TIME", 400);
      }
      const homework = attempt.homework_id ? this.store.homework(attempt.homework_id) : null;
      if (homework && homework.status !== "recall_in_progress") throw new PilotError("HOMEWORK_RECALL_FINISHED");
      const settings = JSON.parse(attempt.settings_snapshot) as PilotSettings;
      if (homework) {
        const accepted = db.prepare(`SELECT COUNT(*) AS count FROM pilot_attempts
          WHERE homework_id = ? AND card_id = ? AND rated_at IS NOT NULL`)
          .get(homework.homeworkId, attempt.card_id) as { count: number };
        if (accepted.count >= settings.maxRecallAttemptsPerCardPerHomework) throw new PilotError("HOMEWORK_ATTEMPT_LIMIT");
      }
      const progress = this.store.progress(attempt.card_id);
      if (!progress.hasRecallHistory && this.queue.newUsedToday(now, attempt.timezone) >= settings.scheduler.newItemsPerDay) {
        throw new PilotError("DAILY_NEW_CARD_LIMIT");
      }
      const item = this.store.item(attempt.card_id);
      if (!item.practiceEnabled) throw new PilotError("CARD_NOT_AVAILABLE_FOR_RECALL");
      // Read and advance current FSRS state under the same write lock. A second
      // in-flight attempt cannot overwrite the first review's state.
      const before = this.store.review(attempt.card_id);
      const review = this.store.practice.recordAttempt({ itemPublicId: attempt.card_id,
        publicId: input.attemptId, mode: "recall", answer: input.answer,
        score: ({ again: 0, hard: .7, good: .85, easy: 1 })[input.rating],
        verdict: input.rating, rating: input.rating, feedback: { rating: input.rating },
        reviewedAt: new Date(now), schedulingPreference: "neutral",
        schedulerSettings: normalizeSchedulerSettings(settings.scheduler) });
      const result: AttemptResult = { ...review, fsrsStateBefore: before,
        fsrsStateAfter: this.store.review(attempt.card_id),
        successfulRecallCount: this.store.progress(attempt.card_id).successfulRecallCount };
      db.prepare("UPDATE pilot_attempts SET rated_at = ?, submission = ?, result = ?, local_day = ? WHERE attempt_id = ?")
        .run(now, JSON.stringify(input), JSON.stringify(result), localDay(now, attempt.timezone), input.attemptId);
      return result;
    }).immediate();
  }
}
