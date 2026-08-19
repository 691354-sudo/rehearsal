import { Pencil, Volume2 } from "lucide-react";
import type { LearningItem } from "../../shared/contracts";
import type { PracticeScope } from "./practiceSelection";

export function PracticeQueuePreview(props: {
  items: LearningItem[];
  language: "en" | "lv";
  mode: "listen" | "recall";
  onEdit: (item: LearningItem) => void;
  onPlay: (item: LearningItem) => void;
  scope: PracticeScope;
}) {
  return <section className="practice-queue-preview" aria-label="Selected cards">
    <header>
      <strong>{props.scope === "due" ? "Due now" : "Library selection"}</strong>
      <span>{props.items.length} {props.items.length === 1 ? "card" : "cards"}</span>
    </header>
    {props.items.length ? <ol>
      {props.items.map((item, index) => <li key={item.publicId}>
        <span className="practice-queue-index">{index + 1}</span>
        <div className="practice-queue-copy">
          <p>{props.mode === "recall" ? item.cue : item.target}</p>
          {props.mode === "listen" ? <span>{item.cue}</span> : null}
          <small>{item.tags[0] || item.source || "Personal"}</small>
        </div>
        <div className="practice-queue-actions">
          {props.language === "en" ? <button aria-label={`Play ${item.target}`} onClick={() => props.onPlay(item)} title="Play" type="button"><Volume2 size={15} /></button> : null}
          <button aria-label={`Edit ${item.target}`} onClick={() => props.onEdit(item)} title="Edit" type="button"><Pencil size={15} /></button>
        </div>
      </li>)}
    </ol> : <p className="practice-queue-empty">{props.scope === "due" ? "Nothing due." : "No matching cards."}</p>}
  </section>;
}
