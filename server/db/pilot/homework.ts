import type { Homework, HomeworkFeedback } from "../../../contracts/learning-pilot.js";
import type { TutorRepository } from "../repositories/tutor.js";
import { PilotListening } from "./listening.js";
import { PilotQueue } from "./queue.js";
import { PilotError, PilotStore } from "./store.js";

export class PilotHomework {
  constructor(private readonly store: PilotStore, private readonly queue: PilotQueue,
    private readonly listening: PilotListening, private readonly tutor: TutorRepository) {}

  active(tutorChatId?: string) {
    const row = this.store.db.prepare(`SELECT homework_id FROM pilot_homework
      WHERE status IN ('recall_in_progress', 'tutor_in_progress', 'awaiting_feedback')
        ${tutorChatId ? "AND tutor_chat_id = ?" : ""} ORDER BY started_at DESC LIMIT 1`)
      .get(...(tutorChatId ? [tutorChatId] : [])) as { homework_id: string } | undefined;
    return row ? this.store.homework(row.homework_id) : null;
  }

  create(input: { homeworkId: string; tutorChatId?: string; requestedMinutes: number; timezone: string },
    now = new Date().toISOString()) {
    const { db } = this.store;
    return db.transaction(() => {
      const previous = db.prepare("SELECT homework_id FROM pilot_homework WHERE homework_id = ?").get(input.homeworkId);
      if (previous) {
        const homework = this.store.homework(input.homeworkId);
        if (homework.requestedMinutes !== input.requestedMinutes
          || (input.tutorChatId && homework.tutorChatId !== input.tutorChatId)) throw new PilotError("HOMEWORK_ID_CONFLICT");
        return homework;
      }
      if (input.tutorChatId && !this.tutor.getThread(input.tutorChatId)) throw new PilotError("TUTOR_CHAT_NOT_FOUND", 404);
      const thread = this.tutor.getOrCreateThread(input.tutorChatId, "en");
      if (this.active(thread.publicId)) throw new PilotError("HOMEWORK_ALREADY_ACTIVE");
      const settings = this.store.settings();
      this.store.identity();
      const total = input.requestedMinutes * 60;
      const pending = this.listening.pending(true);
      const selectedLikes = pending.slice(0, Math.max(1, Math.floor(total / settings.estimatedTutorSecondsPerCard)));
      const likeSeconds = Math.min(total, selectedLikes.length * settings.estimatedTutorSecondsPerCard);
      const capacity = Math.floor((total - likeSeconds)
        / (settings.estimatedRecallSeconds + settings.estimatedTutorSecondsPerCard));
      const cards = this.queue.list({ timezone: input.timezone, excludeIds: selectedLikes.map((request) => request.cardId) }, now, settings)
        .slice(0, capacity);
      const plan = {
        requestedMinutes: input.requestedMinutes, plannedRecallCards: cards.length,
        plannedRecallSeconds: cards.length * settings.estimatedRecallSeconds,
        plannedTutorSeconds: likeSeconds + cards.length * settings.estimatedTutorSecondsPerCard,
        plannedCardIds: cards.map((card) => card.publicId),
        plannedTutorRequestIds: selectedLikes.map((request) => request.tutorRequestId),
        settingsSnapshot: settings, dueCardsAtStart: this.queue.dueCount(now),
      };
      const state = { actualRecallSeconds: 0, actualTutorSeconds: 0, recallFinishedAt: null,
        returnedToTutorAt: null, tutorFinishedAt: null, endedAt: null, continued: false };
      db.prepare(`INSERT INTO pilot_homework(homework_id, tutor_chat_id, language, started_at,
        status, app_version, experiment_version, plan, state) VALUES (?, ?, 'en', ?, ?, ?, ?, ?, ?)`)
        .run(input.homeworkId, thread.publicId, now, cards.length ? "recall_in_progress" : "tutor_in_progress",
          this.store.versions().appVersion, settings.experimentVersion, JSON.stringify(plan), JSON.stringify(state));
      for (const request of selectedLikes) db.prepare(`UPDATE pilot_priority_requests
        SET homework_id = ?, assigned = 1 WHERE request_id = ? AND status = 'pending' AND assigned = 0`)
        .run(input.homeworkId, request.tutorRequestId);
      return this.store.homework(input.homeworkId);
    }).immediate();
  }

  returnToTutor(id: string, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(id);
      if (homework.status !== "recall_in_progress") return homework;
      return this.store.updateHomework(id, { status: "tutor_in_progress", recallFinishedAt: now, returnedToTutorAt: now });
    }).immediate();
  }

  finish(id: string, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(id);
      if (["completed", "cancelled", "awaiting_feedback"].includes(homework.status)) return homework;
      const patch: Partial<Homework> = { status: "awaiting_feedback" };
      if (homework.status === "recall_in_progress") patch.recallFinishedAt = now;
      else {
        patch.tutorFinishedAt = now;
        this.store.db.prepare("UPDATE pilot_tutor_sessions SET completed_at = ? WHERE homework_id = ?")
          .run(now, id);
      }
      return this.store.updateHomework(id, patch);
    }).immediate();
  }

  continue(id: string) {
    const homework = this.store.homework(id);
    if (!["recall_in_progress", "tutor_in_progress"].includes(homework.status)) throw new PilotError("HOMEWORK_STAGE_FINISHED");
    return this.store.updateHomework(id, { continued: true });
  }

  cancel(id: string, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(id);
      if (["completed", "cancelled"].includes(homework.status)) return homework;
      this.releaseRequests(id);
      return this.store.updateHomework(id, { status: "cancelled", endedAt: now,
        ...(homework.status === "recall_in_progress" ? { recallFinishedAt: now } : {}),
        ...(homework.status === "tutor_in_progress" ? { tutorFinishedAt: now } : {}),
      });
    }).immediate();
  }

  feedback(id: string, feedback: HomeworkFeedback, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const homework = this.store.homework(id);
      if (homework.status === "completed") {
        if (JSON.stringify(homework.feedback) !== JSON.stringify(feedback)) throw new PilotError("FEEDBACK_ALREADY_SUBMITTED");
        return homework;
      }
      if (homework.status !== "awaiting_feedback") throw new PilotError("HOMEWORK_NOT_AWAITING_FEEDBACK");
      this.store.db.prepare("INSERT INTO pilot_feedback(homework_id, submitted_at, data) VALUES (?, ?, ?)")
        .run(id, now, JSON.stringify(feedback));
      this.releaseRequests(id);
      return this.store.updateHomework(id, { status: "completed", endedAt: now });
    }).immediate();
  }

  deleteChat(tutorChatId: string) {
    return this.store.db.transaction(() => {
      const homework = this.active(tutorChatId);
      if (homework) this.cancel(homework.homeworkId);
      return this.tutor.deleteThread(tutorChatId);
    })();
  }

  private releaseRequests(id: string) {
    this.store.db.prepare("UPDATE pilot_priority_requests SET assigned = 0 WHERE homework_id = ? AND status = 'pending'").run(id);
  }
}
