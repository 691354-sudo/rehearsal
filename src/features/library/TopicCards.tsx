import { CardActions } from "./CardActions";
import type { Language, LearningItem } from "../../shared/contracts";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressBadge } from "../progress/LearningProgress";

export function TopicCards({ items, language, selected, onToggle, onEdit, onDelete, disabled, sources }: {
  items: LearningItem[];
  language: Language;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  disabled: boolean;
  sources?: Record<string, string>;
}) {
  return <div className="topic-card-list">{items.map((item) => <article key={item.publicId} className={selected?.has(item.publicId) ? "is-selected" : ""}>
    {selected ? <label className="topic-card-check"><input type="checkbox" aria-label={`Select ${item.target}`} checked={selected.has(item.publicId)} disabled={disabled}
      onChange={() => onToggle?.(item.publicId)} /></label> : null}
    <div className="topic-card-copy"><strong lang={language}><FocusedText focusTerms={item.focusTerms} text={item.target} /></strong><span lang="ru">{item.cue}</span></div>
    <footer><div>{sources?.[item.publicId] ? <small>From {sources[item.publicId]}</small> : null}<LearningProgressBadge progress={item.progress} /></div>
      {!selected && onEdit ? <CardActions target={item.target} disabled={disabled} onEdit={() => onEdit(item.publicId)}
        onDelete={onDelete ? () => onDelete(item.publicId) : undefined} /> : null}
    </footer>
  </article>)}</div>;
}
