import { useEffect } from "react";
import { ArrowBigRight, Heart } from "lucide-react";
import type { LearningItem } from "../../shared/contracts";
import { usePilot } from "./PilotProvider";

export function ListenLike({ item }: { item: LearningItem }) {
  const pilot = usePilot();
  useEffect(() => pilot.refreshCard(item.publicId), [item.publicId]);
  const progress = pilot.progress[item.publicId];
  const liked = progress?.liked ?? item.preference === "like";
  const count = progress?.listenCount ?? 0;
  const threshold = progress?.listenTarget ?? 5;
  const pending = pilot.recallPendingIds.includes(item.publicId);
  const sentToRecall = progress?.learningStage === "recall" || progress?.learningStage === "tutor";
  return <div className="pilot-listen-progress">
    {pilot.syncError ? <span className="pilot-sync-error" role="status"><span title={pilot.syncError}>Not synced</span>
      <button onClick={pilot.retry} type="button">Retry</button></span>
      : <span aria-live="polite">{progress?.learningStage === "tutor" ? "Ready for Tutor" : progress?.learningStage === "recall" ? "In Active Recall" : `Listened ${count} / ${threshold}`}</span>}
    <button aria-pressed={sentToRecall} aria-disabled={sentToRecall || pending} className="pilot-like pilot-to-recall"
      onClick={() => { if (!sentToRecall && !pending) pilot.toRecall(item.publicId); }}
      title={sentToRecall ? "Already sent to Recall" : "Send to Recall"} type="button">
      <ArrowBigRight aria-hidden="true" fill={sentToRecall ? "currentColor" : "none"} size={18} />{pending ? "Sending…" : "To Recall"}</button>
    <button aria-pressed={liked} className="pilot-like" onClick={() => pilot.like(item.publicId, !liked)} type="button">
      <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} size={18} />Like</button>
  </div>;
}
