import type { ExportedAttempt, ExportedHomework, ExportedTutor, PilotCardSnapshot, PilotCommon,
  PilotDatasets, PilotReport, StoredTutorContext, TutorSessionRow } from "../../../contracts/learning-pilot-analytics.js";
import type { HomeworkFeedback, ListenAppearance, ListenLike, PilotAttemptGrade, PriorityRequest } from "../../../contracts/learning-pilot.js";
import { PilotParticipants } from "./participants.js";
import { mapRequest } from "./listening.js";
import type { AttemptResult, AttemptRow } from "./recall.js";
import { PilotStore, type HomeworkRow, type PilotEventRow } from "./store.js";
import { intervalSeconds } from "./timing.js";

const unique = <T>(values: T[]) => [...new Set(values)];
export class PilotExport {
  constructor(private readonly store: PilotStore, private readonly participants: PilotParticipants) {}

  report(startedAt: string, endedAt: string, timezone = this.store.timezone()): PilotReport {
    if (!(Date.parse(startedAt) < Date.parse(endedAt))) throw new Error("Report requires a non-empty UTC period");
    return this.store.db.transaction(() => this.read(startedAt, endedAt, timezone))();
  }

  private read(startedAt: string, endedAt: string, timezone: string): PilotReport {
    const { db } = this.store;
    const userId = this.store.identity();
    const common = (row: { app_version: string; experiment_version: string }): PilotCommon => ({
      userId, language: "en", appVersion: row.app_version, experimentVersion: row.experiment_version,
    });
    const beforeEnd = (timestamp: string | null) => timestamp !== null && timestamp < endedAt ? timestamp : null;
    const events = db.prepare("SELECT * FROM pilot_events WHERE created_at >= ? AND created_at < ? ORDER BY created_at, event_id")
      .all(startedAt, endedAt) as PilotEventRow[];
    const listens = events.filter((event) => event.kind === "listen_appearance_completed").map((event) => {
      const data = JSON.parse(event.data) as ListenAppearance;
      const progress = db.prepare("SELECT listen_count_after, became_eligible FROM pilot_listens WHERE event_id = ?")
        .get(event.event_id) as { listen_count_after: number; became_eligible: number };
      return { ...common(event), eventId: event.event_id, createdAt: event.created_at,
        listenSessionId: data.listenSessionId, appearanceId: data.appearanceId, cardId: data.cardId,
        completedAt: data.completedAt, audioRepeatsInAppearance: data.audioRepeatsInAppearance,
        listenCountAfter: progress.listen_count_after, becameRecallEligible: Boolean(progress.became_eligible) };
    });
    const requests = (db.prepare(`SELECT p.*, e.app_version, e.experiment_version, e.created_at
      FROM pilot_priority_requests p JOIN pilot_events e ON e.event_id = p.request_id WHERE p.requested_at < ?
        AND (p.requested_at >= ? OR COALESCE(p.resolved_at, p.cancelled_at, ?) >= ?)
      ORDER BY p.requested_at, p.request_id`).all(endedAt, startedAt, endedAt, startedAt) as Array<{
        request_id: string; card_id: string; requested_at: string; status: PriorityRequest["status"];
        resolved_at: string | null; cancelled_at: string | null; homework_id: string | null;
        app_version: string; experiment_version: string; created_at: string;
      }>).map((row) => {
        const resolvedAt = beforeEnd(row.resolved_at); const cancelledAt = beforeEnd(row.cancelled_at);
        return { ...common(row), ...mapRequest(row), eventId: row.request_id, createdAt: row.created_at,
          resolvedAt, cancelledAt, status: resolvedAt ? "resolved" as const : cancelledAt ? "cancelled" as const : "pending" as const };
      });
    const attempts: ExportedAttempt[] = (db.prepare(`SELECT * FROM pilot_attempts
      WHERE rated_at >= ? AND rated_at < ? ORDER BY rated_at, attempt_id`).all(startedAt, endedAt) as AttemptRow[])
      .map((row) => {
        const grade = JSON.parse(row.submission!) as PilotAttemptGrade;
        const result = JSON.parse(row.result!) as AttemptResult;
        return { ...common(row), eventId: row.attempt_id, createdAt: row.rated_at!,
          settingsSnapshot: JSON.parse(row.settings_snapshot), attemptId: row.attempt_id, cardId: row.card_id, homeworkId: row.homework_id,
          shownAt: row.shown_at, revealedAt: grade.revealedAt, ratedAt: grade.ratedAt,
          responseTimeMs: grade.responseTimeMs, rating: grade.rating, inputMode: grade.inputMode,
          lastListenAt: row.last_listen_at, fsrsStateBefore: result.fsrsStateBefore, fsrsStateAfter: result.fsrsStateAfter,
          queueReason: row.queue_reason, selectionSource: row.homework_id ? "homework_selected" : "standalone",
          wasAnswerRevealedBeforeRating: grade.revealedAt <= grade.ratedAt,
          lastListenDeltaMs: row.last_listen_at ? Date.parse(row.shown_at) - Date.parse(row.last_listen_at) : null,
          dueBefore: result.fsrsStateBefore?.dueAt ?? null, dueAfter: result.fsrsStateAfter?.dueAt ?? null };
      });
    const homeworkRows = db.prepare("SELECT * FROM pilot_homework WHERE started_at >= ? AND started_at < ? ORDER BY started_at")
      .all(startedAt, endedAt) as HomeworkRow[];
    const homework: ExportedHomework[] = homeworkRows.map((row) => {
      const { feedback: _feedback, ...saved } = this.store.homework(row.homework_id);
      const actualEnd = beforeEnd(saved.endedAt);
      const tutorEnd = beforeEnd(saved.tutorFinishedAt);
      const recallEnd = beforeEnd(saved.recallFinishedAt);
      const returned = beforeEnd(saved.returnedToTutorAt);
      const reviews = attempts.filter((attempt) => attempt.homeworkId === row.homework_id);
      const ratedCards = new Set(reviews.map((attempt) => attempt.cardId));
      const dueRated = unique(reviews.filter((attempt) => attempt.dueBefore && attempt.dueBefore <= saved.startedAt).map((attempt) => attempt.cardId));
      const status = actualEnd ? saved.status : tutorEnd || (recallEnd && !returned) ? "awaiting_feedback"
        : returned || saved.plannedRecallCards === 0 ? "tutor_in_progress" : "recall_in_progress";
      return { ...common(row), ...saved, eventId: saved.homeworkId, createdAt: saved.startedAt,
        recallStarted: Boolean(db.prepare("SELECT 1 FROM pilot_attempts WHERE homework_id = ? AND created_at < ? LIMIT 1")
          .get(saved.homeworkId, endedAt)),
        actualRecallSeconds: this.activeSeconds(saved.homeworkId, "recall", endedAt),
        actualTutorSeconds: this.activeSeconds(saved.homeworkId, "tutor", endedAt),
        status, endedAt: actualEnd, tutorFinishedAt: tutorEnd, recallFinishedAt: recallEnd, returnedToTutorAt: returned,
        finishedRecallCards: saved.plannedCardIds.filter((id) => ratedCards.has(id)).length,
        skippedCards: saved.plannedCardIds.filter((id) => !ratedCards.has(id)),
        returnedToTutor: saved.plannedRecallCards === 0 ? null : Boolean(returned),
        againCards: unique(reviews.filter((attempt) => attempt.rating === "again").map((attempt) => attempt.cardId)),
        hardCards: unique(reviews.filter((attempt) => attempt.rating === "hard").map((attempt) => attempt.cardId)),
        dueCardsSkipped: Math.max(0, saved.dueCardsAtStart - dueRated.length),
      };
    });
    const tutorSessions: ExportedTutor[] = (db.prepare(`SELECT * FROM pilot_tutor_sessions WHERE received_at >= ? AND received_at < ?`)
      .all(startedAt, endedAt) as TutorSessionRow[]).map((row) => {
        const context = JSON.parse(row.context) as StoredTutorContext;
        const hw = homeworkRows.find((entry) => entry.homework_id === row.homework_id)
          ?? db.prepare("SELECT * FROM pilot_homework WHERE homework_id = ?").get(row.homework_id) as HomeworkRow;
        const activities = (db.prepare(`SELECT * FROM pilot_tutor_activities
          WHERE homework_id = ? AND created_at < ? ORDER BY message_id, card_id`).all(row.homework_id, endedAt) as Array<{
            card_id: string; activity_type: "explanation" | "exercise"; exercise_type: string | null;
            message_id: number; user_response_message_id: number | null; user_response_at: string | null; created_at: string;
          }>).map((activity) => ({ cardId: activity.card_id, activityType: activity.activity_type,
            exerciseType: activity.exercise_type, messageId: activity.message_id,
            userResponseMessageId: beforeEnd(activity.user_response_at) ? activity.user_response_message_id : null,
            createdAt: activity.created_at }));
        const received = context.cards.map((card) => card.cardId);
        return { ...common(hw), eventId: `tutor:${row.homework_id}`, createdAt: row.received_at,
          homeworkId: row.homework_id, tutorChatId: context.tutorChatId, receivedCardIds: received,
          contextPracticeEligibleCardIds: context.cards.filter((card) => card.eligibleForContextPractice).map((card) => card.cardId),
          completedAt: beforeEnd(row.completed_at), cardsReceived: received.length,
          againCards: context.cards.filter((card) => card.attempts.some((attempt) => attempt.rating === "again")).map((card) => card.cardId),
          hardCards: context.cards.filter((card) => card.attempts.some((attempt) => attempt.rating === "hard")).map((card) => card.cardId),
          explainedCards: unique(activities.filter((activity) => activity.activityType === "explanation").map((activity) => activity.cardId)),
          practicedCards: unique(activities.filter((activity) => activity.activityType === "exercise" && activity.userResponseMessageId !== null).map((activity) => activity.cardId)),
          exerciseTypesUsed: unique(activities.flatMap((activity) => activity.activityType === "exercise" && activity.exerciseType ? [activity.exerciseType] : [])),
          userMessagesCount: (db.prepare("SELECT COUNT(*) AS count FROM pilot_tutor_user_messages WHERE homework_id = ? AND created_at < ?")
            .get(row.homework_id, endedAt) as { count: number }).count, activities,
        };
      });
    const feedback = (db.prepare(`SELECT f.*, h.app_version, h.experiment_version FROM pilot_feedback f
      JOIN pilot_homework h ON h.homework_id = f.homework_id WHERE f.submitted_at >= ? AND f.submitted_at < ?`)
      .all(startedAt, endedAt) as Array<{ homework_id: string; submitted_at: string; data: string; app_version: string; experiment_version: string }>)
      .map((row) => {
        const data = JSON.parse(row.data) as HomeworkFeedback;
        return { ...common(row), eventId: `feedback:${row.homework_id}`, createdAt: row.submitted_at,
          homeworkId: row.homework_id, submittedAt: row.submitted_at, difficulty: data.difficulty, timeFit: data.timeFit,
          nextStepClarity: data.nextStepClarity, tutorHelpfulness: data.tutorHelpfulness ?? null,
          obstacleText: data.obstacleText ?? null, requestedPracticeText: data.requestedPracticeText ?? null };
      });
    const participants = this.participants.list().filter((row) => row.startedAt < endedAt && (!row.endedAt || row.endedAt >= startedAt));
    const snapshots = db.prepare(`SELECT s.*, p.app_version, p.experiment_version FROM pilot_snapshots s
      JOIN pilot_participants p ON p.participant_id = s.participant_id
      WHERE s.snapshot_at >= ? AND s.snapshot_at <= ? ORDER BY s.snapshot_at`)
      .all(startedAt, endedAt) as Array<{ participant_id: string; snapshot_kind: "start" | "end"; snapshot_at: string;
        data: string; app_version: string; experiment_version: string }>;
    const cards = snapshots.flatMap((row) => (JSON.parse(row.data) as PilotCardSnapshot[]).map((card) => ({
      ...common(row), ...card, participantId: row.participant_id, snapshotAt: row.snapshot_at, snapshotKind: row.snapshot_kind,
    })));
    const startSnapshot = snapshots.find((row) => row.snapshot_kind === "start" && row.snapshot_at === startedAt);
    const endSnapshot = snapshots.find((row) => row.snapshot_kind === "end" && row.snapshot_at === endedAt);
    const initial = new Map((startSnapshot ? JSON.parse(startSnapshot.data) as PilotCardSnapshot[] : []).map((card) => [card.cardId, card]));
    const final = new Map((endSnapshot ? JSON.parse(endSnapshot.data) as PilotCardSnapshot[] : []).map((card) => [card.cardId, card]));
    const imported = startSnapshot && endSnapshot ? [...final.keys()].filter((id) => !initial.has(id)) : [];
    const deleted = startSnapshot && endSnapshot ? [...initial.keys()].filter((id) => !final.has(id)) : [];
    const changed = [...final.values()].filter((card) => initial.has(card.cardId)
      && initial.get(card.cardId)?.contentFingerprint !== card.contentFingerprint).map((card) => card.cardId);
    const datasets: PilotDatasets = { pilot_participants: participants, listen_events: listens, tutor_priority_requests: requests,
      recall_attempts: attempts, homework_sessions: homework, tutor_homework_sessions: tutorSessions,
      post_session_feedback: feedback, cards_snapshot: cards };
    return { userId, language: "en", period: { startedAt, endedAt }, timezone,
      settings: this.store.settings(), datasets,
      likeEvents: events.filter((event) => ["listen_like", "listen_unlike"].includes(event.kind)).map((event) => {
        const data = JSON.parse(event.data) as ListenLike;
        return { ...common(event), eventId: event.event_id, createdAt: event.created_at,
          cardId: data.cardId, liked: data.liked, occurredAt: data.occurredAt };
      }),
      snapshotBoundaries: snapshots.map((row) => ({ participantId: row.participant_id, snapshotAt: row.snapshot_at, snapshotKind: row.snapshot_kind })),
      comparison: { complete: Boolean(startSnapshot && endSnapshot && !imported.length && !deleted.length && !changed.length),
        missingStart: !startSnapshot, missingEnd: !endSnapshot, importedCardIds: imported, deletedCardIds: deleted, changedCardIds: changed },
    };
  }

  private activeSeconds(id: string, stage: string, until: string) {
    const rows = this.store.db.prepare(`SELECT e.data FROM pilot_time_intervals t JOIN pilot_events e ON e.event_id = t.event_id
      WHERE t.homework_id = ? AND t.stage = ? AND e.created_at < ?`).all(id, stage, until) as Array<{ data: string }>;
    const entries = rows.map((row) => JSON.parse(row.data) as { measurementLost: boolean; intervals: Array<{ start: string; end: string }> });
    if (!entries.length) {
      const started = stage === "recall"
        ? this.store.db.prepare("SELECT 1 FROM pilot_attempts WHERE homework_id = ? AND created_at < ? LIMIT 1").get(id, until)
        : this.store.db.prepare("SELECT 1 FROM pilot_tutor_sessions WHERE homework_id = ? AND received_at < ?").get(id, until);
      if (started) return null;
    }
    return entries.some((entry) => entry.measurementLost) ? null : intervalSeconds(entries.flatMap((entry) => entry.intervals));
  }
}
