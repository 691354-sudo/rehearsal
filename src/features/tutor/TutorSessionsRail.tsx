import { useEffect, useRef, useState, type RefObject } from "react";
import { PanelLeftClose, Search, SquarePen } from "lucide-react";
import { AppLink } from "../../app/AppLink";
import type { TutorRoute } from "../../lib/appRoute";
import type { ChatThread } from "../../shared/contracts";

const parseThreadDate = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

const formatThreadDate = (value: string) => {
  const date = parseThreadDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
};

export function TutorSessionsRail({ currentThreadId, onClose, onNewChat, open, railRef, route, threads }: {
  currentThreadId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  open: boolean;
  railRef: RefObject<HTMLElement | null>;
  route: TutorRoute;
  threads: ChatThread[];
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleThreads = normalizedQuery
    ? threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalizedQuery))
    : threads;
  const today = new Date().toDateString();
  const groups = [
    { label: "Today", items: visibleThreads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() === today) },
    { label: "Earlier", items: visibleThreads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() !== today) },
  ].filter((group) => group.items.length);

  useEffect(() => {
    if (!open) { setSearchOpen(false); setQuery(""); }
  }, [open]);
  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  return <aside aria-hidden={!open ? "true" : undefined} className={`simple-session-rail ${open ? "is-open" : ""}`}
    inert={!open} ref={railRef}>
    <div className="simple-session-rail-heading">
      <button aria-label="Close sessions" className="simple-session-close" onClick={onClose} type="button"><PanelLeftClose aria-hidden="true" size={18} /></button>
      <strong>Sessions</strong>
      <button aria-expanded={searchOpen} aria-label="Search sessions" onClick={() => setSearchOpen((shown) => !shown)}
        title="Search sessions" type="button"><Search aria-hidden="true" size={16} /></button></div>
    {searchOpen ? <label className="simple-session-search"><span className="simple-visually-hidden">Search sessions</span>
      <Search aria-hidden="true" size={15} /><input autoComplete="off" name="session-search" onChange={(event) => setQuery(event.target.value)}
        placeholder="Search sessions…" ref={searchRef} type="search" value={query} /></label> : null}
    <button className="simple-new-chat" onClick={onNewChat} type="button"><SquarePen aria-hidden="true" size={16} />New chat</button>
    <nav aria-label="Tutor sessions">{groups.map((group) => <section className="simple-session-group" key={group.label}>
      <span>{group.label}</span>
      {group.items.map((thread) => <AppLink aria-current={thread.publicId === currentThreadId ? "page" : undefined}
        className={thread.publicId === currentThreadId ? "is-active" : ""} key={thread.publicId} onClick={onClose}
        route={{ ...route, thread: thread.publicId }}><strong>{thread.title}</strong><small>{formatThreadDate(thread.updatedAt)}</small></AppLink>)}
    </section>)}</nav>
    {normalizedQuery && !visibleThreads.length ? <p className="simple-session-empty">No matching sessions.</p> : null}
  </aside>;
}
