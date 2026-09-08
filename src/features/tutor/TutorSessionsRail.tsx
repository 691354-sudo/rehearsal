import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ChevronDown, Folder, Search, SquarePen, Trash2 } from "lucide-react";
import { AppLink } from "../../app/AppLink";
import type { TutorRoute } from "../../lib/appRoute";
import type { ChatThread } from "../../shared/contracts";
import type { HomeworkSummary } from "../../../contracts/learning-pilot";

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

export function TutorSessionsRail({ currentThreadId, onClose, onNewChat, onDelete, deleting, modal, open, railRef, route, threads, homeworks, homeworkError, onRetryHomework }: {
  currentThreadId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onDelete: () => void;
  deleting: boolean;
  modal: boolean;
  open: boolean;
  railRef: RefObject<HTMLElement | null>;
  route: TutorRoute;
  threads: ChatThread[];
  homeworks: HomeworkSummary[];
  homeworkError: string;
  onRetryHomework: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const homeworkThreads = new Set(homeworks.map((homework) => homework.tutorChatId));
  const visibleThreads = threads.filter((thread) => !homeworkThreads.has(thread.publicId)
    && (!normalizedQuery || thread.title.toLocaleLowerCase().includes(normalizedQuery)));
  const visibleHomeworks = homeworks.filter((homework) => !normalizedQuery || homework.title.toLocaleLowerCase().includes(normalizedQuery));
  const showHomework = homeworkOpen || Boolean(normalizedQuery);
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

  return <aside role={modal && open ? "dialog" : undefined} aria-modal={modal && open ? true : undefined} aria-label="Sessions" aria-hidden={!open ? "true" : undefined} className={`simple-session-rail ${open ? "is-open" : ""}`}
    inert={!open} ref={railRef}>
    <div className="simple-session-rail-heading">
      <button aria-label="Close sessions" className="simple-session-close" onClick={onClose} type="button"><ArrowLeft aria-hidden="true" size={18} /></button>
      <strong>Sessions</strong>
      <button aria-expanded={searchOpen} aria-label="Search sessions" onClick={() => setSearchOpen((shown) => !shown)}
        title="Search sessions" type="button"><Search aria-hidden="true" size={16} /></button></div>
    {searchOpen ? <label className="simple-session-search"><span className="simple-visually-hidden">Search sessions</span>
      <Search aria-hidden="true" size={15} /><input autoComplete="off" name="session-search" onChange={(event) => setQuery(event.target.value)}
        placeholder="Search sessions…" ref={searchRef} type="search" value={query} /></label> : null}
    <button className="simple-new-chat" onClick={onNewChat} type="button"><SquarePen aria-hidden="true" size={16} />New chat</button>
    <nav aria-label="Tutor sessions">
      {route.language === "en" ? <section className="simple-session-group pilot-homework-folder">
        <button aria-expanded={showHomework} aria-controls="homework-sessions" onClick={() => setHomeworkOpen((shown) => !shown)} type="button">
          <Folder aria-hidden="true" size={16} /><strong>Homework</strong><small>{homeworks.length}</small><ChevronDown aria-hidden="true" size={16} /></button>
        <div hidden={!showHomework} id="homework-sessions">
          {homeworkError ? <p role="status">{homeworkError} <button onClick={onRetryHomework} type="button">Retry</button></p> : null}
          {visibleHomeworks.map((homework) => {
            const selected = route.homework ? homework.homeworkId === route.homework
              : homework.tutorChatId === currentThreadId && homeworks.find((entry) => entry.tutorChatId === currentThreadId)?.homeworkId === homework.homeworkId;
            return <AppLink aria-current={selected ? "page" : undefined} className={selected ? "is-active" : ""} key={homework.homeworkId} onClick={onClose}
              route={{ ...route, thread: homework.tutorChatId, review: null, homework: homework.homeworkId }}><strong>{homework.title}</strong>
              <small>{homework.status === "completed" ? "Complete" : homework.status === "cancelled" ? "Cancelled" : "In progress"}</small></AppLink>;
          })}
          {!visibleHomeworks.length && !homeworkError ? <p>{normalizedQuery ? "No matching Homework." : "Your Homework will appear here."}</p> : null}
        </div>
      </section> : null}
      {groups.map((group) => <section className="simple-session-group" key={group.label}>
      <span>{group.label}</span>
      {group.items.map((thread) => <AppLink aria-current={thread.publicId === currentThreadId ? "page" : undefined}
        className={thread.publicId === currentThreadId ? "is-active" : ""} key={thread.publicId} onClick={onClose}
        route={{ ...route, thread: thread.publicId, review: null, homework: undefined }}><strong>{thread.title}</strong><small>{formatThreadDate(thread.updatedAt)}</small></AppLink>)}
    </section>)}</nav>
    {currentThreadId ? <button className="simple-session-delete" disabled={deleting} onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={15} />Delete current chat</button> : null}
    {normalizedQuery && !visibleThreads.length && !visibleHomeworks.length ? <p className="simple-session-empty">No matching sessions.</p> : null}
  </aside>;
}
