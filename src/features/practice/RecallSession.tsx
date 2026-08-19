import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { recallKeyAction, recallSessionReducer, initialRecallSession } from "../../lib/recallSession";
import { ratingFromVerdict, reviewRatings, type ReviewRating } from "../../lib/sessionQueue";
import { capitalize, languageCopy } from "../../shared/config";
import type { AttemptDraft, IslandSummary, Language, LearningItem } from "../../shared/contracts";

const formatInterval = (seconds?: number) => {
  if (seconds === undefined) return "";
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

export function RecallSession(props: {
  attempts: Record<string, AttemptDraft>;
  dueItemIds: string[];
  items: LearningItem[];
  language: Language;
  listeningAvailable: boolean;
  manualReviewItemId: string | null;
  selectedTopicItems: Set<string> | null;
  topics: IslandSummary[];
  topicId: string;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onListenMode: () => void;
  onManualReviewStarted: () => void;
  onRecallReview: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  onTopic: (topicId: string) => void;
}) {
  const [state, dispatch] = useReducer(recallSessionReducer, initialRecallSession);
  const [count, setCount] = useState(props.manualReviewItemId ? "all" : "20");
  const [scope, setScope] = useState<"due" | "custom">(props.manualReviewItemId ? "custom" : "due");
  const inputRef = useRef<HTMLInputElement>(null);
  const dueSet = useMemo(() => new Set(props.dueItemIds), [props.dueItemIds]);
  const candidates = useMemo(() => props.items.filter((item) =>
    (!props.manualReviewItemId || item.publicId === props.manualReviewItemId) &&
    (scope === "custom" || (item.practiceEnabled !== false && dueSet.has(item.publicId))) &&
    (!props.selectedTopicItems || props.selectedTopicItems.has(item.publicId))),
  [dueSet, props.items, props.manualReviewItemId, props.selectedTopicItems, scope]);
  const sessionItems = count === "all" ? candidates : candidates.slice(0, Number(count));
  const current = props.items.find((item) => item.publicId === state.queue[0]);
  const attempt = current ? props.attempts[current.publicId] || { answer: "" } : { answer: "" };

  useEffect(() => {
    if (!attempt.evaluation) return;
    dispatch({ type: "select-rating", rating: ratingFromVerdict(attempt.evaluation.verdict) });
  }, [attempt.evaluation]);
  useEffect(() => {
    if (state.phase === "active") window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [attempt.evaluation, current?.publicId, state.phase]);

  const save = async (rating = state.selectedRating) => {
    if (!current || !attempt.evaluation || state.saving) return;
    dispatch({ type: "select-rating", rating });
    dispatch({ type: "saving" });
    const saved = await props.onRecallReview(current.publicId, rating);
    if (saved) dispatch({ type: "save-succeeded", rating });
    else dispatch({ type: "save-failed" });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key.startsWith("Arrow")) event.preventDefault();
    const action = recallKeyAction(event.key, Boolean(attempt.evaluation), state.selectedRating);
    if (action === "check") props.onCheck(current!.publicId);
    else if (action === "submit") void save();
    else if (action) dispatch({ type: "select-rating", rating: action });
  };

  if (state.phase === "setup") return <section className="recall-setup" aria-label="Recall setup">
    {props.manualReviewItemId ? <p className="recall-manual-label">Manual review · stays Learned</p> : <div className="recall-setup-fields">
      <label><span>Topic</span><select onChange={(event) => props.onTopic(event.target.value)} value={props.topicId}>
        <option value="">All Topics</option>{props.topics.map((topic) => <option key={topic.publicId} value={topic.publicId}>{topic.title}</option>)}
      </select></label>
      <label><span>Cards</span><select onChange={(event) => setCount(event.target.value)} value={count}>
        <option value="10">10</option><option value="20">20</option><option value="50">50</option><option value="all">All {scope === "due" ? "due" : "matching"}</option>
      </select></label>
    </div>}
    <button className="simple-primary recall-start" disabled={!sessionItems.length}
      onClick={() => { dispatch({ type: "start", itemIds: sessionItems.map((item) => item.publicId) }); props.onManualReviewStarted(); }} type="button">
      Start {sessionItems.length ? `${sessionItems.length} cards` : "Recall"}<ChevronRight size={16} />
    </button>
    {!props.manualReviewItemId ? <button className="recall-custom" onClick={() => setScope((currentScope) => currentScope === "due" ? "custom" : "due")} type="button">
      {scope === "due" ? "Custom practice" : "Use Due today"}
    </button> : null}
    {!sessionItems.length ? <p className="recall-empty">{scope === "due" ? "Nothing due." : "No matching cards."}</p> : null}
  </section>;

  if (state.phase === "complete" || !current) return <section className="recall-complete" aria-label="Recall complete">
    <span>Session complete</span><strong>{state.completed} recalled</strong><p>{props.dueItemIds.length} still due</p>
    <div><button className="simple-primary" onClick={() => dispatch({ type: "reset" })} type="button">Start another session</button>
      {props.listeningAvailable ? <button onClick={props.onListenMode} type="button">Listen &amp; Repeat</button> : null}</div>
  </section>;

  const position = state.completed + 1;
  return <section className="recall-session" aria-label="Written active recall">
    <header><button aria-label="End session" onClick={() => dispatch({ type: "reset" })} type="button"><ChevronLeft size={16} />End</button>
      <span>{Math.min(position, state.initialTotal)} / {state.initialTotal}</span></header>
    <article className="recall-card">
      <p className="recall-cue">{current.cue}</p>
      <div className="recall-answer-row"><input aria-label={`Type in ${languageCopy[props.language].label}`} autoComplete="off"
        onChange={(event) => { if (!attempt.evaluation) props.onAnswer(current.publicId, event.target.value); }}
        onKeyDown={onKeyDown} placeholder={`Type in ${languageCopy[props.language].label}`} readOnly={Boolean(attempt.evaluation)} ref={inputRef} value={attempt.answer} />
        {!attempt.evaluation ? <button aria-label="Check answer" className="simple-primary" disabled={!attempt.answer.trim()} onClick={() => props.onCheck(current.publicId)} type="button"><Check size={16} /></button> : null}
      </div>
      {attempt.evaluation ? <div className={`recall-result recall-result--${attempt.evaluation.verdict}`}>
        <span>{attempt.evaluation.verdict === "exact" ? "Correct" : "Compare"}</span>
        {attempt.evaluation.verdict !== "exact" ? <p className="recall-own-answer">{attempt.answer}</p> : null}
        <p className="recall-natural-answer">{attempt.evaluation.naturalAnswer}</p>
        <div className="recall-grades" aria-label="Memory grade">{reviewRatings.map((rating) => <button aria-pressed={state.selectedRating === rating}
          disabled={state.saving} key={rating} onClick={() => void save(rating)} type="button"><span>{capitalize(rating)}</span><small>{formatInterval(current.schedule?.options[rating].intervalSeconds)}</small></button>)}</div>
        {state.error ? <p className="recall-save-error" role="alert">{state.error}</p> : null}
        <small className="recall-key-hint">← → choose · Enter confirm</small>
      </div> : <small className="recall-key-hint">Enter to check</small>}
    </article>
  </section>;
}
