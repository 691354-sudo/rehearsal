import { ArrowRight, Check, Flame } from "lucide-react";
import { dailyGoalKinds, type DailyGoalDay, type DailyGoalKind } from "../../../contracts/daily-goals";
import { useGoals } from "./GoalsProvider";
import { AppLink } from "../../app/AppLink";

export const goalLabels: Record<DailyGoalKind, string> = {
  listen: "Listen & Repeat", recall: "Correct recall", tutor: "Tutor practice",
};
export const dayStatus = (day: DailyGoalDay) => day.allReached ? "Daily goals complete"
  : day.anyReached ? "Streak secured" : "Reach one goal to keep your streak";

export function StreakButton({ className = "" }: { className?: string }) {
  const { data, open } = useGoals();
  return <button className={`goals-streak ${className}`} onClick={open} type="button" aria-label={`Daily goals${data?.startedAt ? `, ${data.streak} day streak` : ""}`}>
    <Flame size={16} aria-hidden="true" /><span>{data?.startedAt ? <>{data.streak}<span className="goals-streak-caption"> day streak</span></> : "Daily goals"}</span>
  </button>;
}

export function GoalRows({ day, interactive = true }: { day: DailyGoalDay; interactive?: boolean }) {
  const { goalRoute } = useGoals();
  return <div className="goals-rows">{dailyGoalKinds.filter((kind) => day.settings[kind].enabled).map((kind) => {
    const count = day.counts[kind]; const target = day.settings[kind].target; const done = count >= target;
    const route = goalRoute(kind);
    const contents = <><span className="goals-row-title">{goalLabels[kind]}</span>
      <span className="goals-count">{count} <span>/ {target}</span>{done ? <Check size={15} aria-label="Complete" /> : null}</span>
      <progress aria-label={goalLabels[kind]} max={target} value={Math.min(count, target)} />
      {!route && interactive ? <small>Available in an audio language</small> : null}</>;
    return interactive && route ? <AppLink className={`goals-row${done ? " is-complete" : ""}`} key={kind} route={route}>{contents}</AppLink>
      : <div className={`goals-row${done ? " is-complete" : ""}`} key={kind}>{contents}</div>;
  })}</div>;
}

export function GoalsSync() {
  const { error, pending, syncError, refresh } = useGoals();
  return <>{pending || syncError ? <p className="goals-sync" role="status">{pending ? `${pending} listening ${pending === 1 ? "pass" : "passes"} awaiting sync` : "Practice changes awaiting sync"} · progress updates after confirmation.</p> : null}
    {error ? <p className="goals-sync" role="status">{error} <button onClick={() => void refresh()} type="button">Retry</button></p> : null}</>;
}

export function TodayGoals({ active, kind }: { active: boolean; kind: "listen" | "recall" }) {
  const { data, error, open, goalRoute, celebrating } = useGoals();
  if (!data) return <section className="goals-today goals-intro" aria-label="Today’s goals"><span>{error ? "Daily goals unavailable" : "Loading daily goals…"}</span><GoalsSync /></section>;
  if (!data.startedAt) return <section className="goals-today goals-intro" aria-label="Today’s goals">
    <div><strong>Make practice a daily habit</strong><p>Set your goals. Reach one to build your streak.</p></div>
    <button className="goals-link" onClick={open} type="button">Set daily goals <ArrowRight size={15} aria-hidden="true" /></button>
  </section>;
  const day = data.today;
  const next = dailyGoalKinds.find((goal) => day.settings[goal].enabled && day.counts[goal] < day.settings[goal].target);
  const nextRoute = next ? goalRoute(next) : null;
  if (active) return <section className={`goals-today goals-compact${celebrating ? " is-celebrating" : ""}`} aria-label="Today’s goals">
    <button onClick={open} type="button"><span role="status">{celebrating ? "Daily goals complete" : `Today · ${goalLabels[kind]}`}</span>
      <strong>{day.counts[kind]}{day.settings[kind].enabled ? ` / ${day.settings[kind].target}` : " · goal off"}</strong>
      {day.anyReached ? <Check size={15} aria-label={dayStatus(day)} /> : null}</button><GoalsSync />
  </section>;
  return <section className={`goals-today${celebrating ? " is-celebrating" : ""}`} aria-labelledby="today-goals-title">
    <div className="goals-today-heading"><h2 id="today-goals-title">Today</h2><button className="goals-link" onClick={open} type="button">View goals</button></div>
    <GoalRows day={day} />
    <div className="goals-today-footer"><p role="status">{dayStatus(day)}{!day.allReached ? ` · ${day.completedGoals} of ${day.enabledGoals} goals complete` : " ✓"}</p>
      {next && nextRoute ? <AppLink className="goals-link" route={nextRoute}>
        Continue {next === "listen" ? "Listening" : next === "recall" ? "Recall" : "Tutor"} <ArrowRight size={15} aria-hidden="true" /></AppLink> : null}</div>
    <GoalsSync />
  </section>;
}
