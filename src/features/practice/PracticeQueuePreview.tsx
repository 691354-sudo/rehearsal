import { useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Volume2 } from "lucide-react";
import type { ReviewRating } from "../../lib/sessionQueue";
import { recallItemIdsAfter } from "../../lib/recallSession";
import type { AttemptDraft, Language, LearningItem } from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import { InlineRecallAnswer } from "./InlineRecallAnswer";
import type { PracticeScope } from "./practiceSelection";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressBadge } from "../progress/LearningProgress";

export function PracticeQueuePreview(props: {
  items: LearningItem[];
  attempts?: Record<string, AttemptDraft>;
  emptyAction?: ReactNode;
  language: Language;
  mode: "listen" | "recall";
  playAfterRecall?: boolean;
  onAnswer?: (itemId: string, value: string) => void;
  onCheck?: (itemId: string) => void;
  onEdit: (item: LearningItem) => void;
  onListened?: (itemId: string) => Promise<void>;
  onPlay: (item: LearningItem) => Promise<unknown>;
  onRecallReview?: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  scope: PracticeScope;
}) {
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleItems = props.items.slice(0, visibleCount);
  const playManually = async (item: LearningItem) => {
    await props.onPlay(item);
    await props.onListened?.(item.publicId);
  };
  const focusAfterReview = (currentItemId: string) => {
    const followingIds = recallItemIdsAfter(props.items.map((item) => item.publicId), currentItemId);
    window.requestAnimationFrame(() => {
      for (const itemId of followingIds) {
        const input = document.getElementsByName(`inline-recall-${itemId}`)[0];
        if (input instanceof HTMLInputElement && !input.readOnly) { input.focus(); return; }
      }
    });
  };
  return <section className={`practice-queue-preview practice-queue-preview--${props.mode}`} aria-label="Selected cards">
    <header>
      <strong>{props.mode === "listen" ? "In this session" : props.scope === "due" ? "Recommended now" : "Library selection"}</strong>
      <span>{props.items.length} {props.items.length === 1 ? "card" : "cards"}</span>
    </header>
    {props.items.length ? <ol>
      {visibleItems.map((item) => <li key={item.publicId}>
        <div className="practice-queue-copy">
          <p lang={props.mode === "recall" ? "ru" : props.language}>{props.mode === "recall" ? item.cue
            : <FocusedText focusTerms={item.focusTerms} text={item.target} />}</p>
          {props.mode === "listen" ? <span lang="ru">{item.cue}</span> : null}
          {props.mode === "recall" && props.attempts && props.onAnswer && props.onCheck && props.onRecallReview
            ? <InlineRecallAnswer attempt={props.attempts[item.publicId] || { answer: "" }} item={item} language={props.language}
              onAnswer={(value) => props.onAnswer!(item.publicId, value)} onCheck={() => props.onCheck!(item.publicId)}
              onCompleted={() => focusAfterReview(item.publicId)}
              onAutoPlay={() => props.onPlay(item)} onPlay={() => playManually(item)} onReview={(rating) => props.onRecallReview!(item.publicId, rating)}
              playAfterCheck={Boolean(props.playAfterRecall)} /> : null}
        </div>
        <div className="practice-queue-side"><div className="practice-queue-actions">
            {languageHasAudio(props.language) ? <button aria-label={`Play ${item.target}`} onClick={() => void playManually(item)} title="Play" type="button"><Volume2 size={15} /></button> : null}
            <button aria-label={`Edit ${item.target}`} onClick={() => props.onEdit(item)} title="Edit" type="button"><Pencil size={15} /></button>
          </div><LearningProgressBadge progress={item.progress} /></div>
      </li>)}
    </ol> : <div className="practice-queue-empty"><span>{props.scope === "due" ? "Nothing recommended right now." : "No matching cards."}</span>{props.emptyAction}</div>}
    {visibleCount < props.items.length ? <button className="practice-load-more" onClick={() => setVisibleCount((count) => count + 10)} type="button">
      Load more <span>{props.items.length - visibleCount} remaining</span>
    </button> : null}
  </section>;
}
