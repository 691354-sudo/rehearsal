import { Heart, Pencil } from "lucide-react";
import type { Island } from "../../shared/contracts";
import { AppLink } from "../../app/AppLink";
import { defaultPracticeRoute } from "../../lib/appRoute";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressBadge } from "../progress/LearningProgress";
import { usePilot } from "./PilotProvider";

export function LikedTopicDetail({ topic, visibleCount, onMore, onEdit }: {
  topic: Island; visibleCount: number; onMore: () => void; onEdit: (id: string) => void;
}) {
  const pilot = usePilot();
  const items = topic.items.filter((item) => pilot.progress[item.publicId]?.liked !== false);
  return <><h3>Liked</h3><p className="topic-meta">{items.length} {items.length === 1 ? "card" : "cards"}</p>
    {items.length ? <div className="topic-toolbar">
      <AppLink route={{ ...defaultPracticeRoute("en"), mode: "listen", scope: "library", topic: "liked" }}>Listen &amp; Repeat</AppLink>
      <AppLink route={{ ...defaultPracticeRoute("en"), mode: "recall", topic: "liked" }}>Active Recall</AppLink>
    </div> : null}
    <div className="topic-card-list">{items.slice(0, visibleCount).map((item) => <article key={item.publicId}>
      <div className="topic-card-copy"><strong lang="en"><FocusedText text={item.target} focusTerms={item.focusTerms} /></strong><span lang="ru">{item.cue}</span></div>
      <footer><LearningProgressBadge progress={item.progress} /><div className="pilot-liked-actions">
        <button aria-label={`Edit ${item.target}`} onClick={() => onEdit(item.publicId)} type="button"><Pencil size={16} aria-hidden="true" /></button>
        <button aria-label={`Unlike ${item.target}`} aria-pressed="true" onClick={() => pilot.like(item.publicId, false)} type="button"><Heart size={17} fill="currentColor" aria-hidden="true" /></button>
      </div></footer>
    </article>)}</div>
    {visibleCount < items.length ? <button onClick={onMore} type="button">Show 20 more</button> : null}
    {!items.length ? <p className="topic-empty">Like a phrase in Listen &amp; Repeat to find it here.</p> : null}
    {pilot.syncError ? <p role="alert">{pilot.syncError} <button onClick={pilot.retry} type="button">Retry</button></p> : null}
  </>;
}
