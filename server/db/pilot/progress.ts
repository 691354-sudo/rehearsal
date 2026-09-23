import type { ReviewRating } from "../../../contracts/api.js";
import type { PilotStore } from "./store.js";

export type PipelineStage = "listen" | "recall" | "tutor";
export const listenCreditIntervalMs = 30 * 60_000;
export type ProgressRow = {
  listen_count: number; recall_eligible_at: string | null; last_listen_at: string | null;
  stage: PipelineStage; listen_target: number; last_credited_at: string | null; entered_at: string | null;
  last_rating: ReviewRating | null; last_good_at: string | null; again_count: number; revision: number; entry_pending: number;
};
export const progressRow = (store: PilotStore, cardId: string) => store.db.prepare(
  "SELECT * FROM pilot_card_progress WHERE card_id=?").get(cardId) as ProgressRow;

export const enterRecall = (store: PilotStore, cardId: string, now: string) => {
  store.db.prepare(`UPDATE pilot_card_progress SET stage='recall', recall_eligible_at=?, entered_at=?,
    last_rating=NULL,last_good_at=NULL,again_count=0,entry_pending=1,revision=revision+1 WHERE card_id=? AND stage='listen'`)
    .run(now, now, cardId);
};

export const advanceLearning = (store: PilotStore, cardId: string, rating: ReviewRating, now: string) => {
  const before = progressRow(store, cardId);
  const againCount = rating === "again" ? before.again_count + 1 : 0;
  const tutorReady = rating === "easy" || (rating === "good" && before.last_rating === "good"
    && before.last_good_at !== null && Date.parse(now) - Date.parse(before.last_good_at) >= 30 * 60_000);
  const returned = againCount >= 2 && store.item(cardId).language !== "lv";
  const stage = returned ? "listen" : tutorReady ? "tutor" : "recall";
  store.db.prepare(`UPDATE pilot_card_progress SET stage=?, listen_target=?, entered_at=?, entry_pending=0,
    last_rating=?,last_good_at=?,again_count=?,revision=revision+1 WHERE card_id=?`)
    .run(stage, returned ? before.listen_count + 2 : before.listen_target,
      stage !== before.stage ? now : before.entered_at,
      returned ? null : rating, !returned && rating === "good" ? now : null,
      returned ? 0 : againCount, cardId);
};
