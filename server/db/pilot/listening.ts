import type { ListenAppearance, ListenLike, PriorityRequest } from "../../../contracts/learning-pilot.js";
import { logChange } from "../repositories/shared.js";
import { PilotError, PilotStore } from "./store.js";

type RequestRow = {
  request_id: string; card_id: string; requested_at: string; status: PriorityRequest["status"];
  resolved_at: string | null; cancelled_at: string | null; homework_id: string | null;
};
export const mapRequest = (row: RequestRow): PriorityRequest => ({
  tutorRequestId: row.request_id, cardId: row.card_id, source: "listen_like",
  requestedAt: row.requested_at, status: row.status, resolvedAt: row.resolved_at,
  cancelledAt: row.cancelled_at, homeworkId: row.homework_id,
});

export class PilotListening {
  constructor(private readonly store: PilotStore) {}

  complete(input: ListenAppearance, now = new Date().toISOString()) {
    const { db } = this.store;
    return db.transaction(() => {
      const event = this.store.event(input.eventId);
      if (event && (event.kind !== "listen_appearance_completed" || event.data !== JSON.stringify(input))) {
        throw new PilotError("PILOT_EVENT_ID_CONFLICT");
      }
      const appearance = db.prepare("SELECT card_id FROM pilot_listens WHERE appearance_id = ?")
        .get(input.appearanceId) as { card_id: string } | undefined;
      if (appearance && appearance.card_id !== input.cardId) throw new PilotError("APPEARANCE_ID_CONFLICT");
      if (event || appearance) return this.store.progress(input.cardId);
      if (Date.parse(input.completedAt) > Date.parse(now) + 60_000) throw new PilotError("INVALID_LISTEN_TIME", 400);
      this.store.item(input.cardId);
      const previous = this.store.progress(input.cardId);
      const listenCount = previous.listenCount + 1;
      const becameEligible = previous.recallEligibleAt === null
        && listenCount >= this.store.settings().listenAppearancesForRecall;
      this.store.addEvent(input.eventId, "listen_appearance_completed", input.cardId, input.completedAt, input, now);
      db.prepare(`INSERT INTO pilot_listens(appearance_id, event_id, card_id, completed_at,
        listen_count_after, became_eligible) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.appearanceId, input.eventId, input.cardId, input.completedAt, listenCount, Number(becameEligible));
      db.prepare(`INSERT INTO pilot_card_progress(card_id, listen_count, recall_eligible_at, last_listen_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET
        listen_count = excluded.listen_count, recall_eligible_at = excluded.recall_eligible_at,
        last_listen_at = MAX(COALESCE(last_listen_at, ''), excluded.last_listen_at)`)
        .run(input.cardId, listenCount, previous.recallEligibleAt ?? (becameEligible ? now : null), input.completedAt);
      // Retain the existing activity views. These are non-FSRS attempts; the event
      // payload and appearance identity live only in the pilot log above.
      this.store.practice.recordAttempt({ itemPublicId: input.cardId, publicId: input.eventId,
        mode: "listen", answer: "", score: 1, verdict: "good", feedback: {}, reviewedAt: new Date(now) });
      return this.store.progress(input.cardId);
    }).immediate();
  }

  like(input: ListenLike, now = new Date().toISOString()) {
    const { db } = this.store;
    return db.transaction(() => {
      const event = this.store.event(input.eventId);
      if (event) {
        if (event.data !== JSON.stringify(input) || !["listen_like", "listen_unlike"].includes(event.kind)) {
          throw new PilotError("PILOT_EVENT_ID_CONFLICT");
        }
        return { liked: this.store.item(input.cardId).preference === "like", pending: this.pending() };
      }
      const item = this.store.item(input.cardId);
      this.store.addEvent(input.eventId, input.liked ? "listen_like" : "listen_unlike",
        input.cardId, input.occurredAt, input, now);
      const preference = input.liked ? "like" : "neutral";
      db.prepare("UPDATE items SET preference = ?, updated_at = ? WHERE public_id = ?")
        .run(preference, now, input.cardId);
      logChange(db, "user", "update", "item", input.cardId, { preference: item.preference }, { preference });
      if (input.liked && item.preference !== "like") {
        db.prepare(`INSERT OR IGNORE INTO pilot_priority_requests(request_id, card_id, requested_at, status)
          VALUES (?, ?, ?, 'pending')`).run(input.eventId, input.cardId, now);
      } else if (!input.liked) {
        this.cancelUnstarted(input.cardId, now);
      }
      return { liked: input.liked, pending: this.pending() };
    }).immediate();
  }

  cancelUnstarted(cardId: string, now = new Date().toISOString()) {
    this.store.db.prepare(`UPDATE pilot_priority_requests SET status = 'cancelled', cancelled_at = ?, assigned = 0
      WHERE card_id = ? AND status = 'pending' AND NOT EXISTS (
        SELECT 1 FROM pilot_tutor_activities a WHERE a.card_id = pilot_priority_requests.card_id
          AND a.homework_id = pilot_priority_requests.homework_id)`)
      .run(now, cardId);
  }

  pending(onlyUnassigned = false) {
    return (this.store.db.prepare(`SELECT p.* FROM pilot_priority_requests p
      JOIN items i ON i.public_id = p.card_id
      WHERE p.status = 'pending' AND i.language_code = 'en' AND i.practice_enabled = 1
        AND EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id)
        ${onlyUnassigned ? "AND p.assigned = 0" : ""}
      ORDER BY p.requested_at, p.card_id, p.request_id`).all() as RequestRow[]).map(mapRequest);
  }
}
