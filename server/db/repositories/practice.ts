import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode, LearningItem } from "../../types.js";
import {
  cardFromStoredState,
  defaultSchedulerSettings,
  normalizeSchedulerSettings,
  previewReview,
  scheduleReview,
  storedStateFromCard,
  type ReviewRating,
  type SchedulerSettings,
} from "../../services/scheduler.js";
import {
  logChange,
  mapItemWithProgress,
  mapJoinedReviewState,
  mapReviewState,
  type DueItemRow,
  type ReviewStateRow,
} from "./shared.js";

export class PracticeRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  getSettings() {
    const row = this.db.prepare(
      "SELECT value FROM app_settings WHERE key = 'scheduler'",
    ).get() as { value: string } | undefined;
    if (!row) return defaultSchedulerSettings;
    try {
      return normalizeSchedulerSettings(JSON.parse(row.value));
    } catch {
      return defaultSchedulerSettings;
    }
  }

  updateSettings(input: SchedulerSettings) {
    const previous = this.getSettings();
    const settings = normalizeSchedulerSettings(input);
    this.db.prepare(
      `INSERT INTO app_settings(key, value) VALUES ('scheduler', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(JSON.stringify(settings));
    logChange(this.db, "user", "update", "app_settings", "scheduler", previous, settings);
    return settings;
  }

  recordAttempt(input: {
    itemPublicId: string;
    mode: string;
    answer: string;
    score: number;
    verdict: string;
    feedback: Record<string, unknown>;
    rating?: ReviewRating;
    reviewedAt?: Date;
  }) {
    const item = this.db.prepare(
      "SELECT id, preference FROM items WHERE public_id = ?",
    ).get(input.itemPublicId) as { id: number; preference: LearningItem["preference"] } | undefined;
    if (!item) throw new Error("Item not found");
    const publicId = randomUUID();
    const reviewedAt = input.reviewedAt || new Date();
    const schedulerSettings = this.getSettings();
    let schedule = null;
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO attempts(public_id, item_id, mode, answer, score, verdict, feedback)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        publicId,
        item.id,
        input.mode,
        input.answer,
        input.score,
        input.verdict,
        JSON.stringify(input.feedback),
      );
      if (input.mode === "recall" && input.rating) {
        const currentRow = this.db.prepare(
          "SELECT * FROM review_state WHERE item_id = ?",
        ).get(item.id) as ReviewStateRow | undefined;
        const currentCard = cardFromStoredState(mapReviewState(currentRow), reviewedAt);
        const result = scheduleReview(currentCard, input.rating, reviewedAt, item.preference, schedulerSettings);
        const next = storedStateFromCard(result.card);
        this.db.prepare(
          `INSERT INTO review_state(
             item_id, due_at, repetitions, lapses, last_score, state, stability,
             difficulty, elapsed_days, scheduled_days, learning_steps, last_review
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET
             due_at = excluded.due_at,
             repetitions = excluded.repetitions,
             lapses = excluded.lapses,
             last_score = excluded.last_score,
             state = excluded.state,
             stability = excluded.stability,
             difficulty = excluded.difficulty,
             elapsed_days = excluded.elapsed_days,
             scheduled_days = excluded.scheduled_days,
             learning_steps = excluded.learning_steps,
             last_review = excluded.last_review,
             updated_at = CURRENT_TIMESTAMP`,
        ).run(
          item.id,
          next.dueAt,
          next.repetitions,
          next.lapses,
          input.score,
          next.state,
          next.stability,
          next.difficulty,
          next.elapsedDays,
          next.scheduledDays,
          next.learningSteps,
          next.lastReview,
        );
        schedule = previewReview(result.card, result.card.due, item.preference, schedulerSettings);
      }
    });
    transaction();
    return { publicId, schedule };
  }

  countAttemptsSince(language: LanguageCode, since: string, mode = "recall") {
    const result = this.db.prepare(
      `SELECT COUNT(*) AS count FROM attempts a
       JOIN items i ON i.id = a.item_id
       WHERE i.language_code = ? AND a.mode = ? AND datetime(a.created_at) >= datetime(?)`,
    ).get(language, mode, since) as { count: number };
    return result.count;
  }

  countActivitySince(language: LanguageCode, since: string) {
    const rows = this.db.prepare(
      `SELECT a.mode, COUNT(*) AS count FROM attempts a
       JOIN items i ON i.id = a.item_id
       WHERE i.language_code = ? AND datetime(a.created_at) >= datetime(?)
       GROUP BY a.mode`,
    ).all(language, since) as Array<{ mode: string; count: number }>;
    const counts = { recall: 0, shadow: 0, pattern: 0 };
    for (const row of rows) {
      if (row.mode === "listen" || row.mode === "shadow") counts.shadow += row.count;
      else if (row.mode in counts) counts[row.mode as keyof typeof counts] = row.count;
    }
    return counts;
  }

  listInventory(language: LanguageCode, limit = 500, now = new Date()) {
    const settings = this.getSettings();
    const rows = this.db.prepare(
      `SELECT i.*,
              r.due_at AS review_due_at,
              r.stability AS review_stability,
              r.difficulty AS review_difficulty,
              r.elapsed_days AS review_elapsed_days,
              r.scheduled_days AS review_scheduled_days,
              r.learning_steps AS review_learning_steps,
              r.repetitions AS review_repetitions,
              r.lapses AS review_lapses,
              r.state AS review_state,
              r.last_review AS review_last_review,
              COALESCE(a.recall_count, 0) AS recall_count,
              COALESCE(a.listen_count, 0) AS listen_count
       FROM items i LEFT JOIN review_state r ON r.item_id = i.id
       LEFT JOIN (
         SELECT item_id,
           SUM(CASE WHEN mode = 'recall' THEN 1 ELSE 0 END) AS recall_count,
           SUM(CASE WHEN mode IN ('listen', 'shadow') THEN 1 ELSE 0 END) AS listen_count
         FROM attempts GROUP BY item_id
       ) a ON a.item_id = i.id
       WHERE i.language_code = ?
       ORDER BY i.updated_at DESC, i.id DESC
       LIMIT ?`,
    ).all(language, limit) as DueItemRow[];
    return rows.map((row) => {
      const item = mapItemWithProgress(row, now);
      const stored = mapJoinedReviewState(row);
      if (!stored) return item;
      return {
        ...item,
        schedule: previewReview(
          cardFromStoredState(stored, now),
          now,
          row.preference,
          settings,
        ),
      };
    });
  }

  listDue(language: LanguageCode, limit = 12, now = new Date(), newLimit = 10) {
    const schedulerSettings = this.getSettings();
    const select = `SELECT i.*,
              r.due_at AS review_due_at,
              r.stability AS review_stability,
              r.difficulty AS review_difficulty,
              r.elapsed_days AS review_elapsed_days,
              r.scheduled_days AS review_scheduled_days,
              r.learning_steps AS review_learning_steps,
              r.repetitions AS review_repetitions,
              r.lapses AS review_lapses,
              r.state AS review_state,
              r.last_review AS review_last_review,
              COALESCE(a.recall_count, 0) AS recall_count,
              COALESCE(a.listen_count, 0) AS listen_count
       FROM items i LEFT JOIN review_state r ON r.item_id = i.id
       LEFT JOIN (
         SELECT item_id,
           SUM(CASE WHEN mode = 'recall' THEN 1 ELSE 0 END) AS recall_count,
           SUM(CASE WHEN mode IN ('listen', 'shadow') THEN 1 ELSE 0 END) AS listen_count
         FROM attempts GROUP BY item_id
       ) a ON a.item_id = i.id`;
    const scheduled = this.db.prepare(
      `${select}
       WHERE i.language_code = ? AND i.practice_enabled = 1
         AND r.due_at IS NOT NULL AND datetime(r.due_at) <= datetime(?)
       ORDER BY CASE COALESCE(r.state, 0) WHEN 1 THEN 0 WHEN 3 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                CASE i.preference WHEN 'like' THEN 0 WHEN 'neutral' THEN 1 ELSE 2 END,
                COALESCE(r.due_at, '1970-01-01')
       LIMIT ?`,
    ).all(language, now.toISOString(), limit) as DueItemRow[];
    const remaining = Math.max(0, limit - scheduled.length);
    const freshLimit = Math.min(remaining, Math.max(0, newLimit));
    const fresh = freshLimit ? this.db.prepare(
      `${select}
       WHERE i.language_code = ? AND i.practice_enabled = 1 AND r.due_at IS NULL
       ORDER BY CASE i.preference WHEN 'like' THEN 0 WHEN 'neutral' THEN 1 ELSE 2 END,
                i.commonness DESC, i.persona_fit DESC, i.created_at
       LIMIT ?`,
    ).all(language, freshLimit) as DueItemRow[] : [];
    return [...scheduled, ...fresh].map((row) => ({
      ...mapItemWithProgress(row, now),
      schedule: previewReview(
        cardFromStoredState(mapJoinedReviewState(row), now),
        now,
        row.preference,
        schedulerSettings,
      ),
    }));
  }
}
