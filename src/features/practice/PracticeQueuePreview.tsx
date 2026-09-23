import { useState } from "react";
import type { ReactNode } from "react";
import { CardActions } from "../library/CardActions";
import { Volume2 } from "lucide-react";
import type { IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import type { PracticeScope } from "./practiceSelection";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressCounts } from "../progress/LearningProgress";
import { CardSources } from "../progress/CardSources";

export function PracticeQueuePreview(props: {
  items: LearningItem[];
  sets: Pick<IslandSummary, "publicId" | "title">[];
  emptyAction?: ReactNode;
  language: Language;
  mode: "listen" | "recall";
  onEdit: (item: LearningItem) => void;
  onDelete?: (item: LearningItem) => void;
  onToRecall?: (item:LearningItem)=>void;
  onListened?: (itemId: string) => Promise<void>;
  onPlay: (item: LearningItem) => Promise<unknown>;
  scope: PracticeScope;
}) {
  const [playError, setPlayError] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const visibleItems = props.items.slice(0, visibleCount);
  const playManually = async (item: LearningItem) => {
    setPlayError("");
    try { await props.onPlay(item); await props.onListened?.(item.publicId); }
    catch (error) { setPlayError(error instanceof Error ? error.message : "Audio unavailable. Try again."); }
  };
  return <section className={`practice-queue-preview practice-queue-preview--${props.mode}`} aria-label="Selected cards">
    <header>
      <strong>{props.mode === "listen" ? "In this session" : props.scope === "due" ? "Recommended now" : "Library selection"}</strong>
      <span>{props.items.length} {props.items.length === 1 ? "card" : "cards"}</span>
    </header>
    {playError ? <p role="alert">{playError}</p> : null}
    {props.items.length ? <ol>
      {visibleItems.map((item) => <li key={item.publicId}>
        <div className="practice-queue-copy">
          <p lang={props.mode === "recall" ? "ru" : props.language}>{props.mode === "recall" ? item.cue
            : <FocusedText focusTerms={item.focusTerms} text={item.target} />}</p>
          {props.mode === "listen" ? <span lang="ru">{item.cue}</span> : null}
        </div>
        <div className="practice-queue-side"><div className="practice-queue-actions">
            {languageHasAudio(props.language) ? <button aria-label={`Play ${item.target}`} onClick={() => void playManually(item)} title="Play" type="button"><Volume2 size={15} /></button> : null}
            <CardActions extraActions={props.mode === "listen" && props.onToRecall ? [{label:"To Recall",onClick:()=>props.onToRecall?.(item)}] : []} target={item.target} onEdit={() => props.onEdit(item)} onDelete={props.onDelete ? () => props.onDelete?.(item) : undefined} />
          </div><span className="learning-progress"><CardSources item={item} sets={props.sets} /><LearningProgressCounts progress={item.progress} /></span></div>
      </li>)}
    </ol> : <div className="practice-queue-empty"><span>{props.scope === "due" ? "Nothing recommended right now." : "No matching cards."}</span>{props.emptyAction}</div>}
    {visibleCount < props.items.length ? <button className="practice-load-more" onClick={() => setVisibleCount((count) => count + 10)} type="button">
      Load more <span>{props.items.length - visibleCount} remaining</span>
    </button> : null}
  </section>;
}
