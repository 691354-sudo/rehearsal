import { useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Volume2 } from "lucide-react";
import type { ReviewRating } from "../../lib/sessionQueue";
import { recallItemIdsAfter } from "../../lib/recallSession";
import type { AttemptDraft, LearningItem } from "../../shared/contracts";
import { InlineRecallAnswer } from "./InlineRecallAnswer";
import type { PracticeScope } from "./practiceSelection";

export function PracticeQueuePreview(props: {
  items: LearningItem[];
  attempts?: Record<string, AttemptDraft>;
  emptyAction?: ReactNode;
  language: "en" | "lv";
  mode: "listen" | "recall";
  playAfterRecall?: boolean;
  onAnswer?: (itemId: string, value: string) => void;
  onCheck?: (itemId: string) => void;
  onEdit: (item: LearningItem) => void;
  onPlay: (item: LearningItem) => Promise<unknown>;
  onRecallReview?: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  scope: PracticeScope;
}) {
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleItems = props.items.slice(0, visibleCount);
  const focusAfterReview = (currentItemId: string) => {
    const followingIds = recallItemIdsAfter(props.items.map((item) => item.publicId), currentItemId);
    window.requestAnimationFrame(() => {
      for (const itemId of followingIds) {
        const input = document.getElementsByName(`inline-recall-${itemId}`)[0];
        if (input instanceof HTMLInputElement && !input.readOnly) { input.focus(); return; }
      }
    });
  };
  return <section className="practice-queue-preview" aria-label="Selected cards">
    <header>
      <strong>{props.scope === "due" ? "Due now" : "Library selection"}</strong>
      <span>{props.items.length} {props.items.length === 1 ? "card" : "cards"}</span>
    </header>
    {props.items.length ? <ol>
      {visibleItems.map((item, index) => <li key={item.publicId}>
        <span className="practice-queue-index">{index + 1}</span>
        <div className="practice-queue-copy">
          <p lang={props.mode === "recall" ? "ru" : props.language}>{props.mode === "recall" ? item.cue : item.target}</p>
          {props.mode === "listen" ? <span lang="ru">{item.cue}</span> : null}
          {props.mode === "recall" && props.attempts && props.onAnswer && props.onCheck && props.onRecallReview
            ? <InlineRecallAnswer attempt={props.attempts[item.publicId] || { answer: "" }} item={item} language={props.language}
              onAnswer={(value) => props.onAnswer!(item.publicId, value)} onCheck={() => props.onCheck!(item.publicId)}
              onCompleted={() => focusAfterReview(item.publicId)}
              onPlay={() => props.onPlay(item)} onReview={(rating) => props.onRecallReview!(item.publicId, rating)}
              playAfterCheck={Boolean(props.playAfterRecall)} /> : null}
        </div>
        <div className="practice-queue-actions">
          {props.language === "en" ? <button aria-label={`Play ${item.target}`} onClick={() => void props.onPlay(item)} title="Play" type="button"><Volume2 size={15} /></button> : null}
          <button aria-label={`Edit ${item.target}`} onClick={() => props.onEdit(item)} title="Edit" type="button"><Pencil size={15} /></button>
        </div>
      </li>)}
    </ol> : <div className="practice-queue-empty"><span>{props.scope === "due" ? "Nothing due right now." : "No matching cards."}</span>{props.emptyAction}</div>}
    {visibleCount < props.items.length ? <button className="practice-load-more" onClick={() => setVisibleCount((count) => count + 10)} type="button">
      Load more <span>{props.items.length - visibleCount} remaining</span>
    </button> : null}
  </section>;
}
