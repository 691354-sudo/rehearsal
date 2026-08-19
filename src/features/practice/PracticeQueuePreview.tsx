import type { LearningItem } from "../../shared/contracts";
import type { PracticeScope } from "./practiceSelection";

export function PracticeQueuePreview(props: {
  items: LearningItem[];
  mode: "listen" | "recall";
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
        <div>
          <p>{props.mode === "recall" ? item.cue : item.target}</p>
          {props.mode === "listen" ? <span>{item.cue}</span> : null}
        </div>
      </li>)}
    </ol> : <p className="practice-queue-empty">{props.scope === "due" ? "Nothing due." : "No matching cards."}</p>}
  </section>;
}
