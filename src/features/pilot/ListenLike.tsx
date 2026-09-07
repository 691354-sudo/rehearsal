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
  const threshold = pilot.settings?.listenAppearancesForRecall ?? 5;
  return <div className="pilot-listen-progress">
    <span>{count >= threshold ? "Ready for Recall" : `Listened ${count} / ${threshold}`}</span>
    <button aria-pressed={liked} className="pilot-like" onClick={() => pilot.like(item.publicId, !liked)} type="button">
      <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} size={18} />Like</button>
    {pilot.pendingCount || pilot.syncError ? <small className="pilot-sync" role="status">
      {pilot.syncError || "Saving progress…"}{pilot.syncError ? <button onClick={pilot.retry} type="button">Retry</button> : null}
    </small> : null}
  </div>;
}
