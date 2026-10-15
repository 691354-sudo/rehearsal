import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export type PracticeOption = { value: string; label: string; menuLabel?: string; detail?: ReactNode; group?: string };

export function pickerTarget(labels: string[], current: number, key: string) {
  if (!labels.length) return null;
  if (key === "Home") return 0;
  if (key === "End") return labels.length - 1;
  if (key === "ArrowDown") return (current + 1) % labels.length;
  if (key === "ArrowUp") return (current - 1 + labels.length) % labels.length;
  if (key.length !== 1 || key === " ") return null;
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (current + offset) % labels.length;
    if (labels[index].toLocaleLowerCase().startsWith(key.toLocaleLowerCase())) return index;
  }
  return null;
}

export function PracticePicker({ children, className = "", label, onChange, options, triggerLabel, value }: {
  children?: ReactNode;
  className?: string;
  label: string;
  onChange: (value: string) => void;
  options: PracticeOption[];
  triggerLabel?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !menu.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const header = document.querySelector(".simple-header")?.getBoundingClientRect().bottom || 0;
      const bottom = window.innerWidth <= 720 ? document.querySelector(".simple-nav")?.getBoundingClientRect().top ?? window.innerHeight : window.innerHeight;
      const below = bottom - rect.bottom - 12; const above = rect.top - header - 12;
      const opensAbove = below < Math.min(menu.current.scrollHeight, 160) && above > below;
      const next = { above: opensAbove, height: Math.max(44, Math.min(460, opensAbove ? above : below)),
        left: Math.max(16 - rect.left, Math.min(0, window.innerWidth - 16 - rect.left - menu.current.offsetWidth)) };
      Object.assign(menu.current.style, { top: next.above ? "auto" : "calc(100% + 6px)", bottom: next.above ? "calc(100% + 6px)" : "auto",
        left: `${next.left}px`, maxHeight: `${next.height}px` });
    };
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    const main = root.current?.closest("main");
    if (main) observer.observe(main);
    place();
    const option = menu.current?.querySelectorAll<HTMLButtonElement>("[role=option]")[selected];
    option?.focus({ preventScroll: true }); option?.scrollIntoView({ block: "nearest" });
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=option]") || [])];
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const next = pickerTarget(options.map((option) => option.menuLabel || option.label), current, event.key)
      ?? pickerTarget(options.map((option) => option.label), current, event.key);
    if (next === null) return;
    event.preventDefault(); buttons[next]?.focus();
  };
  return <div className="topic-progress-picker" ref={root} onKeyDown={navigate} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button aria-controls={id} aria-expanded={open} aria-haspopup="listbox" aria-label={triggerLabel || `${label}: ${options[selected]?.label}`}
      className={`topic-progress-trigger ${className}`} onClick={() => setOpen((shown) => !shown)} ref={trigger} type="button">
      {children || <><span className="topic-progress-trigger-copy"><strong>{options[selected]?.label}</strong></span><ChevronDown aria-hidden="true" size={15} /></>}
    </button>
    {open ? <div aria-label={label} className="topic-progress-options" id={id} ref={menu} role="listbox">
      {options.map((option) => <Fragment key={option.value}>
        {option.group ? <div className="practice-set-group" role="presentation">{option.group}</div> : null}
        <button aria-label={option.menuLabel ? option.label : undefined} aria-selected={option.value === value} onClick={() => { onChange(option.value); close(); }} role="option" tabIndex={-1} type="button">
          <span><strong>{option.menuLabel || option.label}</strong>{option.detail}</span>{option.value === value ? <Check aria-hidden="true" size={15} /> : null}
        </button>
      </Fragment>)}
    </div> : null}
  </div>;
}
