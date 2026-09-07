import type { Island } from "../../../contracts/api.js";
import { likedTopicId, type PilotCard, type PilotSettings } from "../../../contracts/learning-pilot.js";
import { cardFromStoredState, normalizeSchedulerSettings, previewReview } from "../../services/scheduler.js";
import { mapItemWithProgress, mapJoinedReviewState, type DueItemRow } from "../repositories/shared.js";
import { localDay, PilotStore } from "./store.js";

type QueueRow = DueItemRow & { first_recall: string | null; success_count: number; recall_eligible_at: string | null };
export type PilotQueueInput = { limit?: number; timezone?: string; topicId?: string; homeworkId?: string; excludeIds?: string[]; cardId?: string };
const selection = `SELECT i.*,
  r.due_at AS review_due_at, r.stability AS review_stability, r.difficulty AS review_difficulty,
  r.elapsed_days AS review_elapsed_days, r.scheduled_days AS review_scheduled_days,
  r.learning_steps AS review_learning_steps, r.repetitions AS review_repetitions,
  r.lapses AS review_lapses, r.state AS review_state, r.last_review AS review_last_review,
  COALESCE(a.recall_count, 0) AS recall_count, COALESCE(p.listen_count, 0) AS listen_count,
  a.first_recall, COALESCE(a.success_count, 0) AS success_count, p.recall_eligible_at
  FROM items i LEFT JOIN review_state r ON r.item_id = i.id
  LEFT JOIN pilot_card_progress p ON p.card_id = i.public_id
  LEFT JOIN (SELECT item_id, COUNT(*) AS recall_count, MIN(created_at) AS first_recall,
    SUM(verdict IN ('hard', 'good', 'easy')) AS success_count
    FROM attempts WHERE mode = 'recall' GROUP BY item_id) a ON a.item_id = i.id`;

export class PilotQueue {
  constructor(private readonly store: PilotStore) {}

  liked(now = new Date().toISOString()): Island {
    const rows = this.store.db.prepare(`${selection} WHERE i.language_code = 'en' AND i.preference = 'like'
      AND EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id)
      ORDER BY i.updated_at DESC, i.public_id`).all() as QueueRow[];
    const items = rows.map((row) => mapItemWithProgress(row, new Date(now)));
    const progress: Island["progress"] = { new: 0, learning: 0, due: 0, strong: 0, learned: 0, dueNow: 0, recalls: 0, listens: 0 };
    for (const item of items) {
      progress[item.progress.stage]++;
      progress.recalls += item.progress.recalls; progress.listens += item.progress.listens;
    }
    progress.dueNow = this.list({ topicId: likedTopicId }, now).filter((item) => item.hasRecallHistory).length;
    return { publicId: likedTopicId, language: "en", title: "Liked", description: "", items,
      itemCount: items.length, progress, createdAt: "", updatedAt: "" };
  }

  newUsedToday(now: string, timezone: string) {
    const today = localDay(now, timezone);
    const rows = this.store.db.prepare(`SELECT MIN(a.created_at) AS first_recall
      FROM attempts a JOIN items i ON i.id = a.item_id
      WHERE a.mode = 'recall' AND i.language_code = 'en' GROUP BY a.item_id`)
      .all() as Array<{ first_recall: string }>;
    return rows.filter((row) => localDay(utc(row.first_recall), timezone) === today).length;
  }

  dueCount(now: string) {
    return (this.store.db.prepare(`SELECT COUNT(*) AS count FROM items i
      LEFT JOIN review_state r ON r.item_id = i.id
      WHERE i.language_code = 'en' AND i.practice_enabled = 1
        AND EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id)
        AND EXISTS (SELECT 1 FROM attempts a WHERE a.item_id = i.id AND a.mode = 'recall')
        AND julianday(COALESCE(r.due_at, '1970-01-01')) <= julianday(?)`)
      .get(now) as { count: number }).count;
  }

  list(input: PilotQueueInput = {}, now = new Date().toISOString(), settings?: PilotSettings): PilotCard[] {
    const homework = input.homeworkId ? this.store.homework(input.homeworkId) : null;
    const frozen = homework?.settingsSnapshot ?? settings ?? this.store.settings();
    if (homework && (homework.status !== "recall_in_progress"
      || (!homework.continued && (homework.actualRecallSeconds === null || homework.actualTutorSeconds === null
        || homework.actualRecallSeconds >= homework.plannedRecallSeconds
        || homework.actualRecallSeconds + homework.actualTutorSeconds >= homework.requestedMinutes * 60)))) return [];
    const parameters: Array<string | number> = [now, frozen.listenAppearancesForRecall];
    let scope = "";
    if (input.cardId) { scope += " AND i.public_id = ?"; parameters.push(input.cardId); }
    if (input.excludeIds?.length) {
      scope += " AND i.public_id NOT IN (SELECT value FROM json_each(?))";
      parameters.push(JSON.stringify(input.excludeIds));
    }
    if (input.topicId === likedTopicId) scope += " AND i.preference = 'like'";
    else if (input.topicId) {
      scope += ` AND EXISTS (SELECT 1 FROM island_items ii JOIN islands t ON t.id = ii.island_id
        WHERE ii.item_id = i.id AND t.public_id = ? AND t.language_code = 'en')`;
      parameters.push(input.topicId);
    }
    if (homework) {
      scope += ` AND i.public_id IN (SELECT value FROM json_each(?))
        AND (SELECT COUNT(*) FROM pilot_attempts pa WHERE pa.card_id = i.public_id
          AND pa.homework_id = ? AND pa.rated_at IS NOT NULL) < ?`;
      parameters.push(JSON.stringify(homework.plannedCardIds), homework.homeworkId,
        frozen.maxRecallAttemptsPerCardPerHomework);
    }
    // Selection runs against the entire profile DB, independent of UI inventory.
    const rows = this.store.db.prepare(`${selection}
      WHERE i.language_code = 'en' AND i.practice_enabled = 1
        AND EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id)
        AND ((a.recall_count > 0 AND julianday(COALESCE(r.due_at, '1970-01-01')) <= julianday(?))
          OR (COALESCE(a.recall_count, 0) = 0 AND p.listen_count >= ?)) ${scope}
      ORDER BY CASE WHEN a.recall_count > 0 THEN 0 ELSE 1 END,
        julianday(CASE WHEN a.recall_count > 0 THEN COALESCE(r.due_at, '1970-01-01') ELSE p.recall_eligible_at END),
        i.public_id`).all(...parameters) as QueueRow[];
    let remainingNew = Math.max(0, frozen.scheduler.newItemsPerDay
      - this.newUsedToday(now, this.store.timezone(input.timezone)));
    const eligible = rows.filter((row) => row.recall_count || remainingNew-- > 0)
      .slice(0, input.limit ?? rows.length);
    return eligible.map((row) => ({ ...mapItemWithProgress(row, new Date(now)),
      listenCount: row.listen_count ?? 0, recallEligibleAt: row.recall_eligible_at,
      successfulRecallCount: row.success_count, hasRecallHistory: Boolean(row.recall_count),
      queueReason: row.recall_count ? "due" : "new_after_listen_threshold",
      schedule: previewReview(cardFromStoredState(mapJoinedReviewState(row), new Date(now)),
        new Date(now), "neutral", normalizeSchedulerSettings(frozen.scheduler)),
    }));
  }
}

export const utc = (value: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
