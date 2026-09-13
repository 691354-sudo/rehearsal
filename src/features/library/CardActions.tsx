import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { placeLibraryActions, type LibraryActionsPlacement } from "./libraryActions";

export function CardActions({ target, onEdit, onDelete, disabled, extraActions = [], className }: {
  target: string; onEdit: () => void; onDelete?: () => void; disabled?: boolean; className?: string; extraActions?: Array<{ label: string; onClick: () => void }>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<LibraryActionsPlacement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    setPosition(placeLibraryActions(trigger.current.getBoundingClientRect(), menu.current.getBoundingClientRect(),
      { width: window.innerWidth, bottom: window.visualViewport?.height || window.innerHeight }));
  }, [open]);
  useLayoutEffect(() => {
    if (open && position) menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    window.addEventListener("pointerdown", outside); window.addEventListener("resize", dismiss);
    return () => { window.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); };
  }, [open]);
  return <><button aria-label={`More actions for ${target}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
    type="button" className={className} disabled={disabled} ref={trigger} onClick={() => setOpen(!open)}><MoreHorizontal size={18} aria-hidden="true" /></button>
    {open ? createPortal(<div className="card-actions-menu" id={id} ref={menu} role="menu" aria-label="Card actions"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}><button role="menuitem" type="button" onClick={() => { close(); onEdit(); }}><Pencil size={16} />Edit</button>
      {extraActions.map((action) => <button key={action.label} role="menuitem" type="button" onClick={() => { close(); action.onClick(); }}>{action.label}</button>)}
      {onDelete ? <button className="topic-danger" role="menuitem" type="button" onClick={() => { close(); onDelete(); }}><Trash2 size={16} />Delete</button> : null}
    </div>, trigger.current?.closest(".simple-app") ?? document.body) : null}</>;
}
