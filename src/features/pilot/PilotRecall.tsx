import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ChevronRight, Pencil, Settings2, Volume2, X } from "lucide-react";
import type { Homework, PilotAttemptGrade, PilotCard } from "../../../contracts/learning-pilot";
import type { ReviewRating } from "../../../contracts/api";
import type { PracticePage } from "../practice/PracticePage";
import { defaultTutorRoute, navigate } from "../../lib/appRoute";
import { TopicProgressPicker } from "../practice/TopicProgressPicker";
import { PracticeQueuePreview } from "../practice/PracticeQueuePreview";
import { PlaybackSettings } from "../practice/PlaybackSettings";
import { FocusedText } from "../progress/FocusedText";
import type { IslandSummary, LearningItem } from "../../shared/contracts";
import { usePilot } from "./PilotProvider";
import { browserTimezone, pilotErrorMessage, pilotRequest } from "./pilotApi";
import { useActiveTime, useHomeworkTime } from "./useActiveTime";
import { HomeworkFeedback } from "./HomeworkFeedback";
import type { RecallCheck } from "../../../contracts/recall-check";
import { PilotRecallAnswer } from "./PilotRecallAnswer";

type RecallRun = { selectedIds: string[]; completed: number; current: PilotCard | null;
  attemptId: string; shownAt: string; revealedAt: string | null; answer: string; begun: boolean;
  submission?: PilotAttemptGrade; check?: RecallCheck };
const ratings: ReviewRating[] = ["again", "hard", "good", "easy"];
export function PilotRecall({ props, topics, onTopic, onEdit }: {
  props: ComponentProps<typeof PracticePage>; topics: IslandSummary[];
  onTopic: (id: string) => void; onEdit: (item: LearningItem) => void;
}) {
  const pilot = usePilot();
  const homeworkId = props.route.homework;
  const key = `rehearsal:${pilot.profileId}:en:recall:${homeworkId || "standalone"}`;
  const [run, setRunState] = useState<RecallRun | null>(() => JSON.parse(localStorage.getItem(key) || "null"));
  const [queue, setQueue] = useState<PilotCard[]>([]);
  const [homework, setHomework] = useState<Homework | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(true);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [rating, setRating] = useState<ReviewRating>("good");
  const [showSettings, setShowSettings] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null); const good = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const active = Boolean(run?.current && (!homework || homework.status === "recall_in_progress"));
  const attemptClock = useActiveTime(`${key}:attempt:${run?.attemptId || "none"}`, active,
    homework?.settingsSnapshot.idleTimeoutSeconds ?? pilot.settings?.idleTimeoutSeconds ?? 120);
  const time = useHomeworkTime(homework, "recall", active);
  const persist = (next: RecallRun | null) => {
    if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key);
    setRunState(next);
  };
  const loadQueue = async () => {
    const params = new URLSearchParams({ language: "en", timezone: browserTimezone() });
    if (homeworkId) params.set("homeworkId", homeworkId);
    else { if (props.route.topic) params.set("topicId", props.route.topic); if (props.route.cards !== "all") params.set("limit", props.route.cards); }
    const result = await pilotRequest<{ items: PilotCard[] }>(pilot.profileId, `/queue?${params}`);
    const items = props.route.review ? result.items.filter((item) => item.publicId === props.route.review) : result.items;
    setQueue(items); return items;
  };
  const load = async () => {
    setLoading(true); setError("");
    try {
      if (homeworkId) setHomework((await pilotRequest<{ homework: Homework }>(pilot.profileId, `/homework/${homeworkId}?language=en`)).homework);
      await loadQueue();
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [homeworkId, props.route.topic, props.route.cards, props.route.review]);
  useEffect(() => {
    const latest = props.items.find((item) => item.publicId === run?.current?.publicId);
    if (latest && run?.current && (latest.target !== run.current.target || latest.cue !== run.current.cue)) {
      persist({ ...run, check: undefined, current: { ...run.current, target: latest.target, cue: latest.cue, focusTerms: latest.focusTerms } });
    }
  }, [props.items]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(164, Math.max(44, input.current.scrollHeight))}px`;
  }, [run?.answer, run?.revealedAt, run?.current]);
  const begin = async (next: RecallRun) => {
    persist(next); setBusy(true); setError("");
    try {
      await pilotRequest(pilot.profileId, "/attempts/start", { attemptId: next.attemptId, cardId: next.current!.publicId,
        homeworkId, shownAt: next.shownAt, timezone: browserTimezone() });
      persist({ ...next, begun: true });
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const nextCard = (current: PilotCard | null, selectedIds: string[], completed: number): RecallRun => ({
    current, selectedIds, completed, attemptId: crypto.randomUUID(), shownAt: new Date().toISOString(), revealedAt: null, answer: "", begun: false,
  });
  const start = () => { if (queue.length && !busy) void begin(nextCard(queue[0], queue.map((card) => card.publicId), 0)); };
  useEffect(() => {
    if (homework?.status === "recall_in_progress" && !loading && !busy && !run && !error && queue.length) start();
  }, [homework?.status, loading, busy, run, error, queue]);
  const reveal = () => {
    if (!run?.begun || run.revealedAt || busy) return;
    persist({ ...run, revealedAt: new Date().toISOString() }); setRating("good");
    requestAnimationFrame(() => good.current?.focus({ preventScroll: true }));
    if (props.playback.playAfterRecall && run.current) void props.onPlay(run.current.target, props.playback).catch(() => undefined);
  };
  const grade = async (selected: ReviewRating) => {
    if (!run?.current || !run.revealedAt || saving.current) return;
    saving.current = true; setBusy(true); setError(""); setRating(run.submission?.rating ?? selected);
    const submission = run.submission ?? { attemptId: run.attemptId, rating: selected, revealedAt: run.revealedAt,
      ratedAt: new Date().toISOString(), responseTimeMs: attemptClock.seconds(Date.now()) === null ? null : attemptClock.seconds(Date.now())! * 1000,
      inputMode: run.answer.trim() ? "typed" as const : "oral_self_check" as const, answer: run.answer };
    persist({ ...run, submission });
    try {
      if (homework) { const updated = await time.flush(); if (updated) setHomework(updated); }
      await pilotRequest(pilot.profileId, "/attempts/grade", submission);
      const remainingIds = homeworkId ? run.selectedIds : run.selectedIds.filter((id) => id !== run.current!.publicId);
      const available = (await loadQueue()).filter((card) => remainingIds.includes(card.publicId));
      if (available.length) await begin(nextCard(available[0], remainingIds, run.completed + 1));
      else persist({ ...run, completed: run.completed + 1, current: null, submission: undefined });
      props.onModeSelected(); props.onPilotUpdated();
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { saving.current = false; setBusy(false); }
  };
  const homeworkAction = async (action: "return" | "finish" | "cancel" | "continue") => {
    if (!homework || busy || run?.submission) return;
    setBusy(true); setError("");
    try {
      if (homework.status === "recall_in_progress") await time.flush();
      const updated = (await pilotRequest<{ homework: Homework }>(pilot.profileId, `/homework/${homework.homeworkId}/${action}`, {})).homework;
      setHomework(updated); setFeedbackOpen(true);
      if (action === "return") { persist(null); navigate({ ...defaultTutorRoute("en"), thread: updated.tutorChatId, homework: updated.homeworkId }); }
      if (action === "continue") { const cards = await loadQueue(); if (cards[0]) await begin(nextCard(cards[0], updated.plannedCardIds, run?.completed ?? 0)); }
      if (action === "cancel") persist(null);
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const exit = () => { if (!run?.submission) homework ? void homeworkAction("finish") : persist(null); };
  const keyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return;
    const typing = event.target instanceof HTMLTextAreaElement && !event.target.readOnly;
    if (typing && (event.shiftKey || window.matchMedia("(pointer: coarse)").matches)) return;
    if (run?.revealedAt && ["ArrowLeft", "ArrowRight"].includes(event.key) && !typing) {
      event.preventDefault(); const next = ratings[Math.max(0, Math.min(3, ratings.indexOf(rating) + (event.key === "ArrowRight" ? 1 : -1)))];
      setRating(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-rating="${next}"]`)?.focus();
    } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault(); if (run?.revealedAt) void grade(rating); else reveal();
    }
  };
  const failure = error ? <p className="recall-save-error" role="alert">{error} <button disabled={busy} onClick={() => void (run?.submission ? grade(run.submission.rating) : run?.current && !run.begun ? begin(run) : load())} type="button">Retry</button></p> : null;
  if (homework?.status === "awaiting_feedback") return feedbackOpen ? <HomeworkFeedback homework={homework}
    onSaved={(updated) => { setHomework(updated); persist(null); }} onClose={() => setFeedbackOpen(false)} />
    : <section className="recall-complete"><h2>Feedback saved for later</h2><button onClick={() => setFeedbackOpen(true)} type="button">Complete feedback</button><button onClick={() => void homeworkAction("cancel")} type="button">Cancel Homework</button>{failure}</section>;
  if (homework && ["completed", "cancelled"].includes(homework.status)) return <section className="recall-complete"><h2>{homework.status === "completed" ? "Homework complete" : "Homework cancelled"}</h2>
    <button onClick={() => navigate({ ...defaultTutorRoute("en"), thread: homework.tutorChatId })} type="button">Return to Tutor</button></section>;
  if (!run) return <div className="practice-ready-layout">
    {homework ? <div className="pilot-homework-heading"><strong>Homework</strong><button onClick={exit} type="button">End session</button></div> : null}
    <section className="recall-setup" aria-label="Recall setup"><div className="recall-setup-fields">
      {!homework ? <><div className="practice-topic-field"><TopicProgressPicker onChange={onTopic} progressPill topics={topics} value={props.route.topic} /></div>
        <select aria-label="Practice cards" className="practice-card-select" value={props.route.cards} onChange={(event) => props.onRoute({ ...props.route, cards: event.target.value as "all" | "10" | "20" | "50" }, "replace")}>
          <option value="all">All recommended</option><option value="10">10 recommended</option><option value="20">20 recommended</option><option value="50">50 recommended</option></select></> : null}
      <button className="simple-primary recall-start" disabled={loading || busy || !queue.length} onClick={start} type="button">{loading ? "Loading cards…" : `Start ${queue.length} ${queue.length === 1 ? "card" : "cards"}`}<ChevronRight size={16} aria-hidden="true" /></button>
    </div></section>{failure}
    {!loading ? <PracticeQueuePreview items={queue} language="en" mode="recall" scope="due" onEdit={onEdit}
      onPlay={(item) => props.onPlay(item.target, props.playback)} emptyAction={<span>New cards are ready after five listens. Like a phrase to discuss it with Tutor.</span>} /> : null}
    {homework && !loading && !queue.length ? <button className="simple-primary" onClick={() => void homeworkAction("return")} type="button">Return to Tutor</button> : null}
  </div>;
  if (!run.current) return <section className="recall-complete"><h2>Recall finished</h2><p>{run.completed} {run.completed === 1 ? "answer" : "answers"} saved</p>{failure}
    <div>{homework ? <><button className="simple-primary" disabled={busy} onClick={() => void homeworkAction("return")} type="button">Return to Tutor</button><button disabled={busy} onClick={exit} type="button">End session</button></>
      : <button className="simple-primary" onClick={() => { persist(null); void load(); }} type="button">Start another session</button>}</div>
  </section>;
  return <section className="recall-session pilot-recall" aria-label="Active Recall" onKeyDown={keyDown}>
    <header><span>{homework ? "Homework · " : ""}{run.completed + 1} / {homework?.plannedRecallCards ?? run.completed + run.selectedIds.length}</span>
      <div className="recall-session-utilities pilot-recall-utilities"><button aria-label="Edit card" onClick={() => onEdit(run.current!)} type="button"><Pencil size={18} aria-hidden="true" /></button>
        <button aria-label="Voice settings" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} type="button"><Settings2 size={18} aria-hidden="true" /></button>
        <button aria-label="End session" disabled={busy || Boolean(run.submission)} onClick={exit} type="button"><X size={18} aria-hidden="true" /></button></div></header>
    {showSettings ? <PlaybackSettings elevenLabs={props.elevenLabs} language="en" onPlayback={props.onPlayback} playback={props.playback} voices={props.voices} /> : null}
    <article className="recall-card"><span className="pilot-recall-prompt">Say the phrase in English</span><p className="recall-cue" lang="ru">{run.current.cue}</p>
      {!run.revealedAt ? <div className="recall-answer-row"><textarea ref={input} aria-label="Your answer in English" autoComplete="off" lang="en" name="recall-answer" maxLength={4000}
        placeholder="Type in English…" rows={1} value={run.answer} onChange={(event) => persist({ ...run, answer: event.target.value })} /></div>
        : <PilotRecallAnswer key={`${run.attemptId}:${run.current.target}:${run.current.cue}`} profileId={pilot.profileId} attemptId={run.attemptId}
          answer={run.answer} reference={run.current.target} saved={run.check} onChecked={(check) => persist({ ...run, check })} />}
      {!run.revealedAt ? <button className="simple-primary pilot-reveal" disabled={busy || !run.begun} onClick={reveal} type="button">{run.answer.trim() ? "Check answer" : "Show answer"}</button>
        : <div className="recall-result"><div className="recall-natural-row"><span>Card answer</span><button aria-label="Play answer" onClick={() => void props.onPlay(run.current!.target, props.playback)} type="button"><Volume2 size={18} aria-hidden="true" /></button></div>
          <p className="recall-natural-answer" lang="en"><FocusedText text={run.current.target} focusTerms={run.current.focusTerms} /></p>
          <p className="pilot-memory-prompt">How well did you remember?</p><div className="recall-grades pilot-grades" aria-label="Memory grade">{ratings.map((value) => <button key={value} data-rating={value} ref={value === "good" ? good : undefined}
            className={`pilot-grade pilot-grade--${value}`} aria-pressed={rating === value} disabled={busy || Boolean(run.submission && run.submission.rating !== value)} onClick={() => void grade(value)} type="button">{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        </div>}{failure}</article>
    {homework ? <div className="pilot-actions"><button disabled={busy || Boolean(run.submission)} onClick={() => void homeworkAction("return")} type="button">Return to Tutor</button><button disabled={busy || Boolean(run.submission)} onClick={() => void homeworkAction("cancel")} type="button">Cancel Homework</button></div> : null}
  </section>;
}
