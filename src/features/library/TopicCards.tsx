import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
      {!selected ? <details className="topic-actions" onKeyDown={(event) => {
        if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
        <summary aria-label={`More actions for ${item.target}`}><MoreHorizontal aria-hidden="true" size={18} /></summary>
        <div><button disabled={disabled} onClick={(event) => { event.currentTarget.closest("details")!.open = false; onEdit?.(item.publicId); }} type="button"><Pencil size={16} />Edit</button>
          <button className="topic-danger" disabled={disabled} onClick={() => onDelete?.(item.publicId)} type="button"><Trash2 size={16} />Delete</button></div>
      </details> : null}
    </footer>
  </article>)}</div>;
}
