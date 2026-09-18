import { cardScopeSql } from "../card-scope.js";
import type { Island, LanguageCode } from "../../../contracts/api.js";
import { likedTopicId, type PilotCard, type PilotSettings } from "../../../contracts/learning-pilot.js";
import { cardFromStoredState, normalizeSchedulerSettings, previewReview } from "../../services/scheduler.js";
import { mapItem, mapItemWithProgress, mapJoinedReviewState, type DueItemRow } from "../repositories/shared.js";
import { localDay, PilotError, PilotStore } from "./store.js";
import type { ProgressRow } from "./progress.js";

type QueueRow = DueItemRow & ProgressRow & { success_count: number };
export type PilotQueueInput = { language?: LanguageCode; limit?: number; timezone?: string; topicId?: string; categoryId?: string;
  homeworkId?: string; excludeIds?: string[]; cardId?: string; sessionId?: string; allowEarly?: boolean };
const selection = `SELECT i.*,
  r.due_at AS review_due_at, r.stability AS review_stability, r.difficulty AS review_difficulty,
  r.elapsed_days AS review_elapsed_days, r.scheduled_days AS review_scheduled_days,
  r.learning_steps AS review_learning_steps, r.repetitions AS review_repetitions,
  r.lapses AS review_lapses, r.state AS review_state, r.last_review AS review_last_review,
  COALESCE(a.recall_count,0) AS recall_count,COALESCE(a.success_count,0) AS success_count,
  p.listen_count,p.recall_eligible_at,p.last_listen_at,p.stage,p.listen_target,p.entered_at,p.entry_pending
  FROM learning_items i JOIN pilot_card_progress p ON p.card_id=i.public_id
  LEFT JOIN review_state r ON r.item_id=i.id
  LEFT JOIN (SELECT item_id,COUNT(*) AS recall_count,SUM(verdict IN ('hard','good','easy')) AS success_count
    FROM attempts WHERE mode='recall' GROUP BY item_id) a ON a.item_id=i.id`;
const timestamp = (value: string | null | undefined) => value ? Date.parse(utc(value)) : 0;
const tie = (a: QueueRow, b: QueueRow) => a.public_id.localeCompare(b.public_id);

export class PilotQueue {
  constructor(private readonly store: PilotStore) {}
  rows(input: PilotQueueInput = {}) {
    const language = input.language ?? "en";
    const scope = cardScopeSql(this.store.db, language, input);
    return (this.store.db.prepare(`${selection} WHERE i.language_code=? AND i.practice_enabled=1
      AND EXISTS(SELECT 1 FROM island_items ii WHERE ii.item_id=i.id) ${scope.sql}`)
      .all(language,...scope.parameters) as QueueRow[])
      .filter((row) => (!input.cardId || row.public_id === input.cardId) && !input.excludeIds?.includes(row.public_id));
  }
  card(row: QueueRow, now: string, settings = this.store.settings()): PilotCard {
    return { ...mapItemWithProgress(row,new Date(now)),listenCount:row.listen_count,listenTarget:row.listen_target,
      learningStage:row.stage,recallEligibleAt:row.recall_eligible_at,successfulRecallCount:row.success_count,
      hasRecallHistory:Boolean(row.recall_count),queueReason:row.stage === "listen" ? "early_listen" : row.entry_pending ? "new_after_listen_threshold" : "due",
      schedule:previewReview(cardFromStoredState(mapJoinedReviewState(row),new Date(now)),new Date(now),"neutral",normalizeSchedulerSettings(settings.scheduler)) };
  }
  listen(input: PilotQueueInput, now = new Date().toISOString()): PilotCard[] {
    const rows = this.rows(input).filter((row) => row.stage === "listen");
    const started = rows.filter((row) => row.listen_count > 0).sort((a,b) => timestamp(a.last_listen_at)-timestamp(b.last_listen_at)||tie(a,b));
    const mapped = started.map(mapItem);
    const categories = new Set(mapped.flatMap((card) => (card.learningCategoryIds ?? [])));
    const topics = new Set(mapped.map((card) => card.topicId));
    const rank = (row: QueueRow) => {
      if (input.categoryId || input.topicId) return 0;
      const item = mapItem(row);
      return (item.learningCategoryIds ?? []).some((id) => categories.has(id)) ? 0 : topics.has(item.topicId) ? 1 : 2;
    };
    const ranks = new Map(rows.filter((row) => !row.listen_count).map((row) => [row.public_id, rank(row)]));
    const fresh = rows.filter((row) => !row.listen_count).sort((a,b) => ranks.get(a.public_id)!-ranks.get(b.public_id)!||timestamp(a.created_at)-timestamp(b.created_at)||tie(a,b));
    const size = Math.min(input.limit ?? 20, rows.length);
    const startedCount = Math.min(started.length, Math.max(Math.ceil(size*.8),size-fresh.length));
    return [...started.slice(0,startedCount),...fresh.slice(0,size-startedCount)].map((row) => this.card(row,now));
  }
  list(input: PilotQueueInput = {}, now = new Date().toISOString(), settings?: PilotSettings): PilotCard[] {
    const homework = input.homeworkId ? this.store.homework(input.homeworkId) : null;
    if (homework && homework.status !== "recall_in_progress") return [];
    const frozen = homework?.settingsSnapshot ?? settings ?? this.store.settings();
    const size = Math.min(20,input.limit ?? 20);
    let rows = this.rows({ ...input,language:homework?.language ?? input.language });
    if (input.sessionId) { const session=this.session(input.sessionId);if(session.language !== (input.language ?? "en"))throw new PilotError("PRACTICE_SESSION_CONFLICT"); rows=rows.filter((row)=>session.ids.includes(row.public_id)); }
    if (homework) rows = rows.filter((row) => homework.plannedCardIds.includes(row.public_id));
    const due = rows.filter((row) => row.stage === "recall" && (row.recall_count ?? 0) > 0 && timestamp(row.review_due_at) <= Date.parse(now));
    const step = (row: QueueRow) => [1,3].includes(row.review_state ?? 0) ? 0 : 1;
    const cards = new Map(due.map((row) => [row.public_id,this.card(row,now,frozen)]));
    due.sort((a,b) => step(a)-step(b) || (step(a) === 1
      ? (cards.get(a.public_id)!.schedule?.retrievability ?? 0)-(cards.get(b.public_id)!.schedule?.retrievability ?? 0) : 0)
      || timestamp(a.review_due_at)-timestamp(b.review_due_at)||tie(a,b));
    const dueIds = new Set(due.map((row) => row.public_id));
    const arrivals = rows.filter((row) => row.stage === "recall" && !dueIds.has(row.public_id) && (row.entry_pending || !row.recall_count))
      .sort((a,b) => timestamp(a.entered_at)-timestamp(b.entered_at)||tie(a,b));
    const chosen = [...due,...arrivals].slice(0,size);
    if (!homework && (!input.cardId || input.allowEarly)) {
      const early = rows.filter((row) => row.stage === "listen" && row.listen_count === 4 && row.listen_target === 5 && !row.recall_count)
        .sort((a,b) => timestamp(a.last_listen_at)-timestamp(b.last_listen_at)||tie(a,b));
      chosen.push(...early.slice(0,Math.min(Math.floor(size*.2),size-chosen.length)));
    }
    return chosen.map((row) => this.card(row,now,frozen));
  }
  session(sessionId: string) {
    const row = this.store.db.prepare("SELECT * FROM practice_sessions WHERE session_id=?").get(sessionId) as
      { language: LanguageCode; card_ids: string; request: string } | undefined;
    if (!row) throw new PilotError("PRACTICE_SESSION_NOT_FOUND",404);
    return { language:row.language,ids:JSON.parse(row.card_ids) as string[],request:JSON.parse(row.request) as PilotQueueInput };
  }
  start(sessionId: string,input: PilotQueueInput,now = new Date().toISOString()) {
    return this.store.db.transaction(() => {
      const exists = this.store.db.prepare("SELECT request FROM practice_sessions WHERE session_id=?").get(sessionId) as { request:string } | undefined;
      if (exists && exists.request !== JSON.stringify(input)) throw new PilotError("PRACTICE_SESSION_CONFLICT");
      if (!exists) {
        const items = this.list(input,now);
        this.store.db.prepare("INSERT INTO practice_sessions VALUES(?,?,?,?,?)")
          .run(sessionId,input.language ?? "en",JSON.stringify(items.map((card) => card.publicId)),now,JSON.stringify(input));
        return items;
      }
      const session = this.session(sessionId);
      return session.ids.flatMap((cardId) => this.list({language:session.language,cardId,allowEarly:true},now));
    }).immediate();
  }
  newUsedToday(now: string,timezone: string) {
    const rows = this.store.db.prepare("SELECT MIN(created_at) AS at FROM attempts WHERE mode='recall' GROUP BY item_id").all() as {at:string}[];
    return rows.filter((row) => localDay(utc(row.at),timezone) === localDay(now,timezone)).length;
  }
  dueCount(now: string, language: LanguageCode = "en") {
    return this.rows({language}).filter((row) => row.stage === "recall" && row.recall_count && timestamp(row.review_due_at)<=Date.parse(now)).length;
  }
  liked(now = new Date().toISOString(),language: LanguageCode = "en"): Island {
    const rows = this.store.db.prepare(`${selection} WHERE i.language_code=? AND i.preference='like'
      AND EXISTS(SELECT 1 FROM island_items ii WHERE ii.item_id=i.id) ORDER BY i.updated_at DESC,i.public_id`).all(language) as QueueRow[];
    const items = rows.map((row) => this.card(row,now));
    const progress: Island["progress"] = { new:0,learning:0,due:0,strong:0,learned:0,dueNow:0,recalls:0,listens:0 };
    for (const item of items) { progress[item.progress.stage]++;progress.recalls+=item.progress.recalls;progress.listens+=item.progress.listens; }
    progress.dueNow=this.list({language,topicId:likedTopicId},now).filter((item) => item.hasRecallHistory).length;
    return {publicId:likedTopicId,language,title:"Liked",description:"",items,itemCount:items.length,progress,createdAt:"",updatedAt:""};
  }
}
export const utc = (value: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value.replace(" ","T")}Z`;
