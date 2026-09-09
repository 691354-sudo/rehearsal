import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import type { Homework, HomeworkSummary } from "../../../contracts/learning-pilot";
import type { HistoryMode, TutorRoute } from "../../lib/appRoute";
import { defaultPracticeRoute, navigate } from "../../lib/appRoute";
import { usePilot } from "./PilotProvider";
import { browserTimezone, pilotErrorMessage, pilotRequest } from "./pilotApi";
import { useHomeworkTime } from "./useActiveTime";
import { HomeworkFeedback } from "./HomeworkFeedback";

export function useTutorHomework({ route, onRoute, onStartTutor, ready, busy: chatBusy }: {
  route: TutorRoute; onRoute: (route: TutorRoute, mode?: HistoryMode) => void;
  onStartTutor: (homework: Homework) => Promise<boolean>; ready: boolean; busy: boolean;
}) {
  const pilot = usePilot();
  const enabled = route.language === "en" && route.mode === "chat";
  const [homework, setHomework] = useState<Homework | null>(null);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [minutes, setMinutes] = useState("");
  const [introDone, setIntroDone] = useState(false);
  const [loaded, setLoaded] = useState("");
  const [sessions, setSessions] = useState<HomeworkSummary[]>([]);
  const [sessionsError, setSessionsError] = useState("");
  const attemptedIntro = useRef("");
  const startRef = useRef(onStartTutor); startRef.current = onStartTutor;
  const creationKey = `rehearsal:${pilot.profileId}:en:homework-create:${route.thread ?? "new"}`;
  const time = useHomeworkTime(homework, "tutor", enabled && homework?.status === "tutor_in_progress" && !route.review);
  const identity = `${pilot.profileId}:${route.language}:${route.mode}:${route.thread}:${route.homework}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const intro = async (session: Homework) => {
    if (!ready || chatBusy || busy) return;
    attemptedIntro.current = identity;
    setBusy(true); setError(""); setOpen(true);
    try {
      const sent = await startRef.current(session);
      if (identityRef.current !== identity) return;
      if (sent) { setIntroDone(true); setOpen(false); }
      else setError("Tutor could not finish the first reply. Your Homework is saved. Try Start Tutor again.");
    } catch (caught) { if (identityRef.current === identity) setError(pilotErrorMessage(caught)); }
    finally { if (identityRef.current === identity) setBusy(false); }
  };
  const refreshSessions = async () => {
    if (!enabled) return;
    try {
      const result = await pilotRequest<{ sessions: HomeworkSummary[] }>(pilot.profileId, "/homework?language=en");
      if (identityRef.current === identity) { setSessions(result.sessions); setSessionsError(""); }
    } catch { if (identityRef.current === identity) setSessionsError("Homework could not be loaded."); }
  };
  const refresh = async () => {
    if (!enabled) return;
    const result = route.homework ? await pilotRequest<{ homework: Homework; tutorStarted: boolean }>(pilot.profileId, `/homework/${route.homework}?language=en`)
      : await pilotRequest<{ homework: Homework | null; tutorStarted?: boolean }>(pilot.profileId,
        `?language=en${route.thread ? `&tutorChatId=${route.thread}` : ""}`);
    if (identityRef.current !== identity) return;
    const next = result.homework;
    setHomework(next); setLoaded(identity);
    if (route.homework && next?.status === "recall_in_progress") setOpen(true);
    if (next && next.tutorChatId === route.thread && next.status === "tutor_in_progress") {
      setIntroDone(Boolean(result.tutorStarted));
    }
    if (next?.status === "awaiting_feedback") setOpen(true);
  };
  useEffect(() => {
    setHomework(null); setOpen(false); setBusy(false); setIntroDone(false); setError(""); setLoaded("");
    attemptedIntro.current = "";
    if (enabled) {
      void refreshSessions();
      void refresh().catch((caught) => {
        if (identityRef.current === identity) { setError(pilotErrorMessage(caught)); setOpen(true); }
      });
    } else { setSessions([]); setSessionsError(""); }
  }, [identity]);
  useEffect(() => {
    if (loaded !== identity || !route.homework || !ready || busy || chatBusy || introDone || error
      || !homework || homework.tutorChatId !== route.thread || homework.status !== "tutor_in_progress"
      || attemptedIntro.current === identity) return;
    void intro(homework);
  }, [identity, loaded, ready, busy, chatBusy, introDone, error, homework]);
  const create = async () => {
    if (busy || chatBusy) return;
    const requestedMinutes = Number(minutes);
    if (!/^\d+$/.test(minutes.trim()) || !Number.isSafeInteger(requestedMinutes) || requestedMinutes < 1 || requestedMinutes > 1440) {
      setError("Enter a whole number of minutes, from 1 to 1440."); return;
    }
    const saved = localStorage.getItem(creationKey);
    const request = saved ? JSON.parse(saved) : { homeworkId: crypto.randomUUID(),
      requestedMinutes, timezone: browserTimezone() };
    localStorage.setItem(creationKey, JSON.stringify(request)); setBusy(true); setError("");
    try {
      const result = await pilotRequest<{ homework: Homework }>(pilot.profileId, "/homework", request);
      setHomework(result.homework); localStorage.removeItem(creationKey);
      onRoute({ ...route, thread: result.homework.tutorChatId, homework: result.homework.homeworkId, review: null }, "replace");
      setOpen(true);
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const action = async (kind: "finish" | "cancel" | "continue") => {
    if (!homework || busy || chatBusy) return;
    setBusy(true); setError("");
    try {
      if (homework.status === "tutor_in_progress") await time.flush();
      const result = await pilotRequest<{ homework: Homework }>(pilot.profileId, `/homework/${homework.homeworkId}/${kind}`, {});
      setHomework(result.homework); setOpen(true); void pilot.refresh(); void refreshSessions();
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const beforeSend = async () => {
    if (!enabled || !homework || homework.tutorChatId !== route.thread) return {};
    if (["completed", "cancelled"].includes(homework.status)) return { homeworkId: homework.homeworkId };
    if (homework.status !== "tutor_in_progress") { setOpen(true); throw new Error("HOMEWORK_STAGE_FINISHED"); }
    const updated = await time.flush(); if (updated) setHomework(updated);
    if (updated && !updated.continued && (updated.actualRecallSeconds === null || updated.actualTutorSeconds === null || updated.actualRecallSeconds + updated.actualTutorSeconds >= updated.requestedMinutes * 60)) {
      setOpen(true); throw new Error("HOMEWORK_TIME_FINISHED");
    }
    return { homeworkId: homework.homeworkId };
  };
  const startRecall = () => {
    if (!homework) return;
    navigate({ ...defaultPracticeRoute("en"), mode: "recall", scope: "due", homework: homework.homeworkId });
  };
  const waiting = homework && homework.tutorChatId !== route.thread;
  const timeFinished = homework && !homework.continued && (homework.actualRecallSeconds === null || homework.actualTutorSeconds === null
    || homework.actualRecallSeconds + homework.actualTutorSeconds >= homework.requestedMinutes * 60);
  const active = homework && !["completed", "cancelled"].includes(homework.status);
  const toolbar = enabled ? <div className="pilot-homework-bar">
    <span>{active ? homework.status === "awaiting_feedback" ? "Feedback waiting" : "Homework in progress"
      : `${pilot.pendingRequests.length} ${pilot.pendingRequests.length === 1 ? "phrase" : "phrases"} waiting for Tutor`}</span>
    <button aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} type="button"><Clock3 size={16} aria-hidden="true" />Homework</button>
    {active && !waiting && homework.status === "tutor_in_progress" ? <button disabled={busy || chatBusy} onClick={() => void action("finish")} type="button">End session</button> : null}
  </div> : null;
  const panel = !enabled || !open ? null : <div className="pilot-homework-panel">
    {error ? <p role="alert">{error}</p> : null}
    {waiting ? <><p>Your saved Homework is in another chat.</p><button className="simple-primary" onClick={() => onRoute({ ...route, thread: homework.tutorChatId, homework: homework.homeworkId })} type="button">Continue Homework</button></>
      : homework?.status === "awaiting_feedback" ? <HomeworkFeedback key={homework.homeworkId} homework={homework} onSaved={(updated) => { setHomework(updated); void pilot.refresh(); void refreshSessions(); }} onClose={() => setOpen(false)} />
        : active ? <>
          {homework.status === "recall_in_progress" ? <><h2>Homework</h2><p>{homework.plannedRecallCards} Recall {homework.plannedRecallCards === 1 ? "card" : "cards"} · {homework.plannedTutorRequestIds.length} liked phrases for Tutor</p>
            <p>Recall ~{Math.ceil(homework.plannedRecallSeconds / 60)} min · Tutor ~{Math.ceil(homework.plannedTutorSeconds / 60)} min</p>
            <button className="simple-primary" onClick={startRecall} type="button">Start Active Recall</button></>
            : timeFinished ? <><h2>{homework.actualRecallSeconds === null || homework.actualTutorSeconds === null ? "Study time is unavailable" : "Planned time is up"}</h2><div className="pilot-actions"><button className="simple-primary" disabled={busy} onClick={() => void action("finish")} type="button">End session</button>
              <button disabled={busy} onClick={() => void action("continue")} type="button">Continue</button></div></>
              : !introDone ? <button className="simple-primary" disabled={!ready || busy || chatBusy} onClick={() => void intro(homework)} type="button">{busy ? "Starting Tutor…" : "Start Tutor"}</button>
                : <p>Continue chatting with Tutor. When you're ready, choose End session.</p>}
          <button disabled={busy || chatBusy} onClick={() => void action("cancel")} type="button">Cancel Homework</button>
        </> : <>
          {homework ? <h2>{homework.status === "completed" ? "Homework complete" : "Homework cancelled"}</h2> : null}
          <p lang="ru">Привет! Сколько у тебя времени на homework?</p>
          <form className="pilot-minutes" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label>Minutes<input autoComplete="off" inputMode="numeric" name="homework-minutes" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
            <button className="simple-primary" disabled={busy || chatBusy} type="submit">{busy ? "Preparing…" : "Prepare Homework"}</button></form>
          <p className="pilot-notice">The English pilot records listening, ratings, study time and optional feedback. Audio and full chats are excluded from the pilot export.</p>
        </>}
  </div>;
  return { toolbar, panel, open, sessions, sessionsError, refreshSessions, beforeSend, refresh, active: enabled && Boolean(active || open), homework };
}
