import { useEffect } from "react";
import { Heart } from "lucide-react";
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
  return <div className="pilot-listen-progress">
    {pilot.syncError ? <span className="pilot-sync-error" role="status"><span title={pilot.syncError}>Not synced</span>
      <button onClick={pilot.retry} type="button">Retry</button></span>
      : <span aria-live="polite">{progress?.learningStage === "tutor" ? "Ready for Tutor" : progress?.learningStage === "recall" ? "In Active Recall" : `Listened ${count} / ${threshold}`}</span>}
    {(!progress?.learningStage || progress.learningStage === "listen") ? <button className="pilot-like" disabled={pending} onClick={() => pilot.toRecall(item.publicId)} type="button">{pending ? "Sending…" : "To Recall"}</button> : null}
    <button aria-pressed={liked} className="pilot-like" onClick={() => pilot.like(item.publicId, !liked)} type="button">
      <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} size={18} />Like</button>
  </div>;
}
