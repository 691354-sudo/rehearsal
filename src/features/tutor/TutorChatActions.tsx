import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { apiFetch } from "../../shared/api";

export function TutorChatActions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && menu.contains(event.target)) return;
      menu.open = false;
    };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, []);
  return <details className="simple-chat-actions" ref={ref}>
    <summary aria-label="More chat actions" role="button"><Ellipsis aria-hidden="true" size={18} /></summary>
    <div onClick={(event) => {
      if ((event.target as HTMLElement).closest("button:not(:disabled)") && ref.current) ref.current.open = false;
    }}>{children}</div>
  </details>;
}

export function TutorThreadActions({ threadId, title, busy, deleting, onRenamed, onError, onDelete }: {
  threadId: string; title: string; busy: boolean; deleting: boolean;
  onRenamed: () => Promise<unknown>; onError: (error: string) => void; onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const rename = async () => {
    const next = window.prompt("Chat name", title);
    if (!next?.trim()) return;
    setRenaming(true);
    try {
      const response = await apiFetch(`/api/chat/${threadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next.trim() }) });
      if (!response.ok) throw new Error();
      await onRenamed();
    } catch { onError("Chat could not be renamed. Use a name of up to 120 characters and try again."); }
    finally { setRenaming(false); }
  };
  return <><button disabled={busy || deleting || renaming} onClick={() => void rename()} type="button"><Pencil size={15} aria-hidden="true" />Rename chat</button>
    <button className="simple-delete-chat" disabled={busy || deleting || renaming} onClick={onDelete} type="button">
      {deleting ? <LoaderCircle className="simple-spin" size={15} /> : <Trash2 size={15} aria-hidden="true" />}Delete chat</button></>;
}
