import { createHash, randomUUID } from "node:crypto";
import type { PilotCardSnapshot, PilotParticipant } from "../../../contracts/learning-pilot-analytics.js";
import type { ReviewRating } from "../../../contracts/api.js";
import { localDay, PilotError, PilotStore } from "./store.js";

export type ParticipantRow = {
  participant_id: string; started_at: string; scheduled_end_at: string; ended_at: string | null;
  timezone: string; app_version: string; experiment_version: string;
};
export class PilotParticipants {
  constructor(private readonly store: PilotStore) {}

  list(): PilotParticipant[] {
    return (this.store.db.prepare("SELECT * FROM pilot_participants ORDER BY started_at").all() as ParticipantRow[])
      .map((row) => ({ userId: this.store.identity(), language: "en", nativeLanguage: "ru",
        participantId: row.participant_id, startedAt: row.started_at, scheduledEndAt: row.scheduled_end_at,
        endedAt: row.ended_at, timezone: row.timezone, appVersion: row.app_version, experimentVersion: row.experiment_version }));
  }

  start(timezone: string, now = new Date().toISOString()) {
    localDay(now, timezone);
    return this.store.db.transaction(() => {
      if (this.list().some((participant) => participant.endedAt === null)) throw new PilotError("PILOT_ALREADY_ENROLLED");
      const id = randomUUID();
      const versions = this.store.versions();
      const end = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
      this.store.db.prepare(`INSERT INTO pilot_participants(participant_id, language, started_at,
        scheduled_end_at, timezone, app_version, experiment_version) VALUES (?, 'en', ?, ?, ?, ?, ?)`)
        .run(id, now, end, timezone, versions.appVersion, versions.experimentVersion);
      this.snapshot(id, "start", now);
      return this.list().find((participant) => participant.participantId === id)!;
    }).immediate();
  }

  end(participantId: string, now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const participant = this.list().find((entry) => entry.participantId === participantId);
      if (!participant) throw new PilotError("PILOT_PARTICIPANT_NOT_FOUND", 404);
      if (participant.endedAt) return participant;
      // Snapshot the actual boundary. Never backdate a snapshot after downtime.
      this.snapshot(participantId, "end", now);
      this.store.db.prepare("UPDATE pilot_participants SET ended_at = ? WHERE participant_id = ?").run(now, participantId);
      return { ...participant, endedAt: now };
    }).immediate();
  }

  closeExpired(now = new Date().toISOString()) {
    const expired = this.store.db.prepare(`SELECT participant_id FROM pilot_participants
      WHERE ended_at IS NULL AND scheduled_end_at <= ?`).all(now) as Array<{ participant_id: string }>;
    for (const row of expired) this.end(row.participant_id, now);
  }

  private snapshot(participantId: string, kind: "start" | "end", now: string) {
    const rows = this.store.db.prepare(`SELECT i.public_id, i.cue, i.target, i.practice_enabled,
      EXISTS (SELECT 1 FROM island_items ii WHERE ii.item_id = i.id) AS owned,
      (SELECT a.verdict FROM attempts a WHERE a.item_id = i.id AND a.mode = 'recall' ORDER BY a.id DESC LIMIT 1) AS last_rating,
      (SELECT p.request_id FROM pilot_priority_requests p WHERE p.card_id = i.public_id AND p.status = 'pending') AS pending_id
      FROM items i WHERE i.language_code = 'en' ORDER BY i.public_id`).all() as Array<{
        public_id: string; cue: string; target: string; practice_enabled: number; owned: number;
        last_rating: ReviewRating | null; pending_id: string | null;
      }>;
    const snapshot: PilotCardSnapshot[] = rows.map((row) => {
      const progress = this.store.progress(row.public_id);
      const state = this.store.review(row.public_id);
      return { cardId: row.public_id, listenCount: progress.listenCount, recallEligibleAt: progress.recallEligibleAt,
        hasRecallHistory: progress.hasRecallHistory, successfulRecallCount: progress.successfulRecallCount,
        lastRating: row.last_rating, due: progress.hasRecallHistory ? state?.dueAt ?? null : null,
        fsrsState: state, isActive: Boolean(row.practice_enabled && row.owned), pendingTutorRequestId: row.pending_id,
        contentFingerprint: createHash("sha256").update(JSON.stringify([row.cue, row.target])).digest("hex") };
    });
    this.store.db.prepare("INSERT INTO pilot_snapshots(participant_id, snapshot_kind, snapshot_at, data) VALUES (?, ?, ?, ?)")
      .run(participantId, kind, now, JSON.stringify(snapshot));
  }
}
