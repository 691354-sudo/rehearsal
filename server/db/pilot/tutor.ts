import type { HomeworkTutorCard, HomeworkTutorContext, PilotAttemptGrade, TutorActivity } from "../../../contracts/learning-pilot.js";
import type { TutorRepository } from "../repositories/tutor.js";
import type { AttemptRow } from "./recall.js";
import { PilotError, PilotStore } from "./store.js";

export class PilotTutor {
  constructor(private readonly store: PilotStore, private readonly tutor: TutorRepository) {}

  receive(homeworkId: string, tutorChatId: string, now = new Date().toISOString()): HomeworkTutorContext {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(homeworkId);
      if (homework.tutorChatId !== tutorChatId) throw new PilotError("HOMEWORK_CHAT_MISMATCH");
      const previous = this.store.db.prepare("SELECT context FROM pilot_tutor_sessions WHERE homework_id = ?")
        .get(homeworkId) as { context: string } | undefined;
      if (previous) return this.withTime(JSON.parse(previous.context));
      if (homework.status !== "tutor_in_progress") throw new PilotError("HOMEWORK_TUTOR_NOT_STARTED");
      const attempts = this.store.db.prepare(`SELECT * FROM pilot_attempts
        WHERE homework_id = ? AND rated_at IS NOT NULL ORDER BY rated_at, attempt_id`)
        .all(homeworkId) as AttemptRow[];
      const likes = this.store.db.prepare(`SELECT request_id, card_id FROM pilot_priority_requests
        WHERE request_id IN (SELECT value FROM json_each(?)) AND status = 'pending'
        ORDER BY requested_at, card_id, request_id`).all(JSON.stringify(homework.plannedTutorRequestIds)) as Array<{
          request_id: string; card_id: string;
        }>;
      const ids = [...new Set([...likes.map((like) => like.card_id), ...attempts.map((attempt) => attempt.card_id)])];
      const cards: HomeworkTutorCard[] = [];
      for (const cardId of ids) {
        const exists = this.store.db.prepare(`SELECT 1 FROM items i WHERE i.public_id = ?
          AND i.language_code = 'en' AND i.practice_enabled = 1
          AND EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id)`).get(cardId);
        if (!exists) continue;
        const item = this.store.item(cardId);
        const progress = this.store.progress(cardId);
        const recall = attempts.filter((attempt) => attempt.card_id === cardId).map((attempt) => {
          const grade = JSON.parse(attempt.submission!) as PilotAttemptGrade;
          return { attemptId: attempt.attempt_id, rating: grade.rating, ratedAt: grade.ratedAt, inputMode: grade.inputMode };
        });
        const like = likes.find((request) => request.card_id === cardId);
        cards.push({ cardId, cue: item.cue, targetPhrase: item.target, translation: item.cue,
          latestRating: recall.at(-1)?.rating ?? null, source: like ? "listen_like" : "recall_result",
          tutorRequestId: like?.request_id ?? null, successfulRecallCount: progress.successfulRecallCount,
          eligibleForContextPractice: Boolean(like) || progress.successfulRecallCount >= homework.settingsSnapshot.successfulRecallsForTutor,
          attempts: recall });
      }
      const priority = (card: HomeworkTutorCard) => card.source === "listen_like" ? 0
        : card.attempts.some((attempt) => attempt.rating === "again") ? 1
          : card.attempts.some((attempt) => attempt.rating === "hard") ? 2 : 3;
      cards.sort((a, b) => priority(a) - priority(b));
      const context: HomeworkTutorContext = {
        homeworkId, tutorChatId, userId: this.store.identity(), language: "en", nativeLanguage: "ru",
        requestedMinutes: homework.requestedMinutes, actualRecallSeconds: homework.actualRecallSeconds,
        actualTutorSeconds: homework.actualTutorSeconds, remainingSeconds: null, cards,
      };
      this.store.db.prepare("INSERT INTO pilot_tutor_sessions(homework_id, received_at, context) VALUES (?, ?, ?)")
        .run(homeworkId, now, JSON.stringify(context));
      return this.withTime(context);
    }).immediate();
  }

  withTime(context: HomeworkTutorContext): HomeworkTutorContext {
    const homework = this.store.homework(context.homeworkId);
    return { ...context, actualRecallSeconds: homework.actualRecallSeconds, actualTutorSeconds: homework.actualTutorSeconds,
      remainingSeconds: homework.actualRecallSeconds === null || homework.actualTutorSeconds === null ? null
        : Math.max(0, homework.requestedMinutes * 60 - homework.actualRecallSeconds - homework.actualTutorSeconds) };
  }

  previousActivities(homeworkId: string) {
    return this.store.db.prepare(`SELECT card_id AS cardId, activity_type AS activityType,
      message_id AS messageId FROM pilot_tutor_activities WHERE homework_id = ?
      AND user_response_message_id IS NULL ORDER BY message_id DESC LIMIT 30`).all(homeworkId);
  }

  attachUser(homeworkId: string, messageId: number, planning: boolean, now = new Date().toISOString()) {
    const homework = this.store.homework(homeworkId);
    if (homework.status !== "tutor_in_progress") throw new PilotError("HOMEWORK_TUTOR_NOT_STARTED");
    const thread = this.tutor.getThread(homework.tutorChatId);
    const row = this.store.db.prepare("SELECT thread_id, role, metadata FROM chat_messages WHERE id = ?")
      .get(messageId) as { thread_id: number; role: string; metadata: string } | undefined;
    if (!row || row.thread_id !== thread?.id || row.role !== "user") throw new PilotError("HOMEWORK_MESSAGE_MISMATCH");
    const alreadyAttached = JSON.parse(row.metadata).homeworkId === homeworkId;
    if (!alreadyAttached && !homework.continued && (homework.actualRecallSeconds === null || homework.actualTutorSeconds === null
      || homework.actualRecallSeconds + homework.actualTutorSeconds >= homework.requestedMinutes * 60)) {
      throw new PilotError("HOMEWORK_TIME_FINISHED");
    }
    this.store.db.prepare("UPDATE chat_messages SET metadata = ? WHERE id = ?")
      .run(JSON.stringify({ ...JSON.parse(row.metadata), homeworkId, homeworkPlanning: planning }), messageId);
    if (!planning) this.store.db.prepare("INSERT OR IGNORE INTO pilot_tutor_user_messages(message_id, homework_id, created_at) VALUES (?, ?, ?)")
      .run(messageId, homeworkId, now);
  }

  saveReply(input: { homeworkId: string; userMessageId: number; content: string; activities: TutorActivity[];
    respondedToMessageIds: number[]; metadata: Record<string, unknown> }, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(input.homeworkId);
      const thread = this.tutor.getThread(homework.tutorChatId);
      if (!thread || homework.status !== "tutor_in_progress") throw new PilotError("HOMEWORK_TUTOR_NOT_STARTED");
      const context = this.receive(homework.homeworkId, homework.tutorChatId, now);
      const user = this.store.db.prepare("SELECT role, thread_id, metadata FROM chat_messages WHERE id = ?")
        .get(input.userMessageId) as { role: string; thread_id: number; metadata: string } | undefined;
      if (!user || user.role !== "user" || user.thread_id !== thread.id) throw new PilotError("HOMEWORK_MESSAGE_MISMATCH");
      const activities = input.activities.filter((activity) => context.cards.some((card) =>
        card.cardId === activity.cardId && (activity.activityType === "explanation" || card.eligibleForContextPractice)));
      const messageId = this.tutor.addMessage(thread.id, "assistant", input.content,
        { ...input.metadata, homeworkId: homework.homeworkId });
      for (const activity of activities) this.store.db.prepare(`INSERT OR IGNORE INTO pilot_tutor_activities
        (homework_id, card_id, activity_type, exercise_type, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(homework.homeworkId, activity.cardId, activity.activityType, activity.exerciseType, messageId, now);
      if (!JSON.parse(user.metadata).homeworkPlanning) {
        for (const previousId of new Set(input.respondedToMessageIds)) {
          // Only a saved earlier assistant message in this same chat can be answered.
          this.store.db.prepare(`UPDATE pilot_tutor_activities SET user_response_message_id = ?, user_response_at = ?
            WHERE homework_id = ? AND message_id = ? AND message_id < ? AND user_response_message_id IS NULL
              AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = message_id AND m.thread_id = ? AND m.role = 'assistant')`)
            .run(input.userMessageId, now, homework.homeworkId, previousId, input.userMessageId, thread.id);
        }
        this.store.db.prepare(`UPDATE pilot_priority_requests SET status = 'resolved', resolved_at = ?, assigned = 0
          WHERE homework_id = ? AND status = 'pending' AND request_id IN (SELECT value FROM json_each(?))
            AND EXISTS (SELECT 1 FROM pilot_tutor_activities a WHERE a.homework_id = pilot_priority_requests.homework_id
              AND a.card_id = pilot_priority_requests.card_id AND a.user_response_message_id IS NOT NULL)`)
          .run(now, homework.homeworkId, JSON.stringify(homework.plannedTutorRequestIds));
      }
      return messageId;
    }).immediate();
  }
}
