import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { IslandSummary } from "../../shared/contracts";
import { TopicProgress } from "../progress/LearningProgress";

export function TopicProgressPicker({ onChange, progressPill = false, topics, value }: {
  onChange: (topicId: string) => void;
  progressPill?: boolean;
  topics: IslandSummary[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = topics.find((topic) => topic.publicId === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false); triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      const options = rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]");
      options?.[Math.max(0, topics.findIndex((topic) => topic.publicId === value) + 1)]?.focus();
    });
  }, [open, topics, value]);

  const choose = (topicId: string) => {
    onChange(topicId); setOpen(false); triggerRef.current?.focus();
  };
  const navigate = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") || [])];
    if (!options.length) return;
    event.preventDefault();
    const current = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : event.key === "ArrowDown" ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
    options[next].focus();
  };
  return <div className="topic-progress-picker" ref={rootRef}>
    <button aria-controls={listboxId} aria-expanded={open} aria-haspopup="listbox"
      aria-label={selected ? `Topic: ${selected.title}, ${selected.progress.dueNow} due, ${selected.progress.new} not recalled yet` : "Topic: All Topics"}
      className="topic-progress-trigger" onClick={() => setOpen((shown) => !shown)} ref={triggerRef} type="button">
      <span className="topic-progress-trigger-copy"><strong>{selected?.title || "All Topics"}</strong>{selected && !progressPill ? <small>{selected.progress.dueNow} due · {selected.progress.new} not recalled yet</small> : null}</span>
      <span className="topic-progress-trigger-end">
        {selected && progressPill ? <small aria-hidden="true" className="topic-progress-trigger-count">{selected.progress.dueNow} · {selected.progress.new}</small> : null}
        <ChevronDown aria-hidden="true" size={15} />
      </span>
    </button>
    {open ? <div aria-label="Topic" className="topic-progress-options" id={listboxId} onBlur={() => {
      window.requestAnimationFrame(() => {
        if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
      });
    }} onKeyDown={navigate} role="listbox">
      <button aria-selected={!value} onClick={() => choose("")} role="option" type="button">
        <span><strong>All Topics</strong><small>{topics.length} topics</small></span>{!value ? <Check aria-hidden="true" size={15} /> : null}
      </button>
      {topics.map((topic) => <button aria-selected={topic.publicId === value} key={topic.publicId}
        onClick={() => choose(topic.publicId)} role="option" type="button">
        <span><strong>{topic.title}</strong><TopicProgress progress={topic.progress} /></span>
        {topic.publicId === value ? <Check aria-hidden="true" size={15} /> : null}
      </button>)}
    </div> : null}
  </div>;
}
