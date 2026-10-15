import { useEffect, useRef, useState } from "react";
import { Award, Check, X } from "lucide-react";
import type { AppRoute } from "../../lib/appRoute";
import { useGoals } from "./GoalsProvider";
import { dayStatus, GoalRows, GoalsSync } from "./TodayGoals";
import { EditGoals } from "./EditGoals";

const historyLabels = { empty: "No activity", progress: "Progress", partial: "Streak secured", complete: "Full day" };
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
export function DailyGoalsPanel({ onClose }: { onClose: () => void }) {
  const { data, error, save, celebrating } = useGoals();
  const [editing, setEditing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const allowed = useRef(false);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestClose = () => {
    if (dirtyRef.current && !window.confirm("Discard unsaved daily goals?")) return;
    allowed.current = true; closeRef.current();
  };
  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      if (trigger?.isConnected && trigger !== document.body) trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>(window.matchMedia("(max-width: 720px)").matches
        ? ".simple-mobile-menu-button" : ".goals-desktop-streak")?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: Event) => {
      if ((event as CustomEvent<{ route: AppRoute }>).detail?.route.goals || allowed.current) return;
      if (!window.confirm("Discard unsaved daily goals?")) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("app-before-navigate", warn); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("app-before-navigate", warn); window.removeEventListener("beforeunload", unload); };
  }, [dirty]);
  const day = data?.history.find((entry) => entry.date === selectedDay) ?? data?.today;
  const form = data && (!data.startedAt || editing);
  return <dialog aria-labelledby="daily-goals-title" className="goals-dialog" ref={dialogRef}
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className={`goals-panel${celebrating ? " is-celebrating" : ""}`}>
      <header><div><h2 id="daily-goals-title">{editing ? "Edit goals" : "Daily goals"}</h2>
        <small>{data ? `Resets at 00:00 · ${data.timezone}` : "Your daily practice"}</small></div>
        <button aria-label="Close daily goals" onClick={requestClose} type="button"><X size={20} /></button></header>
      <div className="goals-panel-body">
        {!data ? <><p>{error ? "Daily goals unavailable." : "Loading daily goals…"}</p><GoalsSync /></> : form ? <>
          <EditGoals settings={data.today.settings} start={!data.startedAt} save={save} onDirty={setDirty}
            onSaved={() => { setEditing(false); setSelectedDay(null); }} />
          {data.startedAt ? <button className="goals-link" type="button" onClick={() => {
            if (dirty && !window.confirm("Discard unsaved daily goals?")) return;
            setDirty(false); setEditing(false);
          }}>Cancel editing</button> : null}
        </> : day ? <>
          <div className="goals-panel-progress"><h3>{day.date === data.today.date ? "Today" : dateLabel(day.date)}</h3>
            {day.anyReached ? <p role="status">{dayStatus(day)}</p> : null}<GoalRows day={day} interactive={day.date === data.today.date} /></div>
          <GoalsSync />
          <div className="goals-records"><div><strong>{data.streak}</strong><span>Current streak</span></div>
            <div><strong>{data.bestStreak}</strong><span>Best streak</span></div><div><strong>{data.fullDays}</strong><span>Full days</span></div></div>
          <section className="goals-history" aria-labelledby="goals-history-title"><h3 id="goals-history-title">Last 28 days</h3>
            <div className="goals-calendar">{Array.from({ length: 28 - data.history.length }, (_, index) => <span className="goals-before-start" key={`before-${index}`} aria-hidden="true" />)}
              {data.history.map((entry) => <button className={`is-${entry.status}`} key={entry.date} type="button"
                aria-pressed={entry.date === day.date} aria-label={`${dateLabel(entry.date)}: ${historyLabels[entry.status]}, ${entry.completedGoals} of ${entry.enabledGoals} goals complete`}
                title={`${dateLabel(entry.date)} · ${historyLabels[entry.status]}`} onClick={() => setSelectedDay(entry.date)}>
                <span>{Number(entry.date.slice(-2))}</span>{entry.allReached ? <Check size={11} aria-hidden="true" /> : null}</button>)}</div>
            <div className="goals-legend">{Object.entries(historyLabels).map(([status, label]) => <span key={status}><i className={`is-${status}`} />{label}</span>)}</div>
          </section>
          <section className="goals-achievements"><h3>Achievements</h3><div>{data.achievements.map((achievement) => <div className={achievement.earned ? "is-earned" : ""} key={achievement.days}>
            <Award size={20} aria-hidden="true" /><strong>{achievement.days} full days</strong><small>{achievement.earned ? "Earned" : `${Math.min(data.fullDays, achievement.days)} / ${achievement.days}`}</small></div>)}</div>
            <p>Full days don’t need to be consecutive. Today joins your record after midnight.</p></section>
          <button className="goals-edit-button" type="button" onClick={() => setEditing(true)}>Edit goals</button>
        </> : null}
      </div>
    </section>
  </dialog>;
}
