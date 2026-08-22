import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Settings2, Volume2, X } from "lucide-react";
import { recallKeyAction, recallSessionReducer, initialRecallSession } from "../../lib/recallSession";
import { ratingFromVerdict, reviewRatings, type ReviewRating } from "../../lib/sessionQueue";
import { capitalize, languageCopy, languageHasAudio } from "../../shared/config";
import type { AttemptDraft, ElevenLabsConfig, IslandSummary, Language, LearningItem, PlaybackPreferences } from "../../shared/contracts";
import { PlaybackSettings } from "./PlaybackSettings";
import { AnswerDiff } from "./AnswerDiff";
import { PracticeQueuePreview } from "./PracticeQueuePreview";
import { LearningProgressBadge } from "../progress/LearningProgress";
import { TopicProgressPicker } from "./TopicProgressPicker";
import { buildPracticeSelection, type PracticeScope } from "./practiceSelection";
import type { PracticeCardCount } from "../../lib/appRoute";

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
  count: PracticeCardCount;
  dueItemIds: string[];
  emptyAction: ReactNode;
  elevenLabs: ElevenLabsConfig;
  items: LearningItem[];
  language: Language;
  listeningAvailable: boolean;
  manualReviewItemId: string | null;
  recommended: { due: number; new: number };
  selectedTopicItems: Set<string> | null;
  topics: IslandSummary[];
  topicId: string;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onCount: (count: PracticeCardCount) => void;
  onEdit: (item: LearningItem) => void;
  onListenMode: () => void;
  onListened: (itemId: string) => Promise<void>;
  onManualReviewStarted: () => void;
  onRecallReview: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<unknown>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onScope: (scope: PracticeScope) => void;
  onTopic: (topicId: string) => void;
  playback: PlaybackPreferences;
  scope: PracticeScope;
  voices: string[];
}) {
  const [state, dispatch] = useReducer(recallSessionReducer, initialRecallSession);
  const [showPlaybackSettings, setShowPlaybackSettings] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sourceItems = useMemo(() => props.manualReviewItemId
    ? props.items.filter((item) => item.publicId === props.manualReviewItemId)
    : props.items, [props.items, props.manualReviewItemId]);
  const sessionItems = useMemo(() => buildPracticeSelection(
    sourceItems,
    props.dueItemIds,
    props.selectedTopicItems,
    props.count === "all" ? "all" : Number(props.count),
    props.scope,
  ), [props.count, props.dueItemIds, props.scope, props.selectedTopicItems, sourceItems]);
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
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" || event.key.startsWith("Arrow")) event.preventDefault();
    const action = recallKeyAction(event.key, Boolean(attempt.evaluation), state.selectedRating);
    if (action === "check") check();
    else if (action === "submit") void save();
    else if (action) dispatch({ type: "select-rating", rating: action });
  };
  const check = () => {
    if (!current || !attempt.answer.trim()) return;
    props.onCheck(current.publicId);
    if (languageHasAudio(props.language) && props.playback.playAfterRecall) {
      void props.onPlay(current.target, props.playback).catch(() => undefined);
    }
  };

  const startButton = <button className="simple-primary recall-start" disabled={!sessionItems.length}
    onClick={() => { dispatch({ type: "start", itemIds: sessionItems.map((item) => item.publicId) }); props.onManualReviewStarted(); }} type="button">
    <span className="recall-start-desktop">Focus mode</span><span className="recall-start-mobile">Start {sessionItems.length ? `${sessionItems.length} cards` : "Recall"}</span><ChevronRight size={16} />
  </button>;

  if (state.phase === "setup") return <div className="practice-ready-layout">
    <section className="recall-setup" aria-label="Recall setup">
      {props.manualReviewItemId ? <><p className="recall-manual-label">Manual review · stays Learned</p>{startButton}</> : <>
        <div className="practice-scope-switch" role="group" aria-label="Recall source">
          <button aria-pressed={props.scope === "due"} onClick={() => props.onScope("due")} type="button">Recommended now</button>
          <button aria-pressed={props.scope === "custom"} onClick={() => props.onScope("custom")} type="button">All Library</button>
        </div>
        {props.scope === "due" ? <small className="practice-recommended-note">FSRS puts due and relearning first, then up to your daily limit of new cards · {props.recommended.due} due · {props.recommended.new} new</small> : null}
        <div className="recall-setup-fields">
          <label><span>Topic</span><TopicProgressPicker onChange={props.onTopic} topics={props.topics} value={props.topicId} /></label>
          <label><span>Cards</span><select name="recall-count" onChange={(event) => props.onCount(event.target.value as PracticeCardCount)} value={props.count}>
            <option value="all">All {props.scope === "due" ? "recommended" : "matching"}</option><option value="10">10</option><option value="20">20</option><option value="50">50</option>
          </select></label>
          {startButton}
        </div>
      </>}
    </section>
    <PracticeQueuePreview attempts={props.attempts} emptyAction={props.emptyAction} items={sessionItems} language={props.language} mode="recall"
      onAnswer={props.onAnswer} onCheck={props.onCheck} onEdit={props.onEdit}
      onListened={props.onListened}
      onPlay={(item) => props.onPlay(item.target, props.playback)} onRecallReview={props.onRecallReview}
      playAfterRecall={props.playback.playAfterRecall} scope={props.scope} />
  </div>;

  if (state.phase === "complete" || !current) return <section className="recall-complete" aria-label="Recall complete">
    <span>Session complete</span><strong>{state.completed} recalled</strong><p>{props.dueItemIds.length} still due</p>
    <div><button className="simple-primary" onClick={() => dispatch({ type: "reset" })} type="button">Start another session</button>
      {props.listeningAvailable ? <button onClick={props.onListenMode} type="button">Listen &amp; Repeat</button> : null}</div>
  </section>;

  const position = state.completed + 1;
  return <section className="recall-session" aria-label="Written active recall">
    <header><span>{Math.min(position, state.initialTotal)} / {state.initialTotal}</span></header>
    <article className="recall-card">
      <LearningProgressBadge progress={current.progress} />
      <p className="recall-cue" lang="ru">{current.cue}</p>
      <div className="recall-answer-row"><textarea aria-label={`Type in ${languageCopy[props.language].label}`} autoComplete="off" lang={props.language} name="recall-answer"
        onChange={(event) => { if (!attempt.evaluation) props.onAnswer(current.publicId, event.target.value); }}
        onKeyDown={onKeyDown} placeholder={`Type in ${languageCopy[props.language].label}…`} readOnly={Boolean(attempt.evaluation)} ref={inputRef} rows={2} value={attempt.answer} />
        {!attempt.evaluation ? <button aria-label="Check answer" className="simple-primary" disabled={!attempt.answer.trim()} onClick={check} type="button"><Check size={16} /></button> : null}
      </div>
      {attempt.evaluation ? <div aria-live="polite" className={`recall-result recall-result--${attempt.evaluation.verdict}`}>
        <span>{attempt.evaluation.verdict === "exact" ? "Correct" : "Compare"}</span>
        {attempt.evaluation.verdict === "exact" ? <div className="recall-natural-row"><p className="recall-natural-answer" lang={props.language}>{attempt.evaluation.naturalAnswer}</p>
          {languageHasAudio(props.language) ? <button aria-label="Play natural answer" onClick={() => {
            void props.onPlay(current.target, props.playback).then(() => props.onListened(current.publicId));
          }} title="Play" type="button"><Volume2 size={16} /></button> : null}</div> : <AnswerDiff answerTokens={attempt.evaluation.answerTokens}
          expectedTokens={attempt.evaluation.expectedTokens} language={props.language} onPlay={languageHasAudio(props.language) ? () => {
            void props.onPlay(current.target, props.playback).then(() => props.onListened(current.publicId));
          } : undefined} />}
        <div className="recall-grades" aria-label="Memory grade">{reviewRatings.map((rating) => <button aria-pressed={state.selectedRating === rating}
          disabled={state.saving} key={rating} onClick={() => void save(rating)} type="button"><span>{capitalize(rating)}</span><small>{formatInterval(current.schedule?.options[rating].intervalSeconds)}</small></button>)}</div>
        {state.error ? <p className="recall-save-error" role="alert">{state.error}</p> : null}
        <small className="recall-key-hint">← → choose · Enter confirm</small>
      </div> : <small className="recall-key-hint">Enter to check</small>}
    </article>
    <div className="recall-session-settings"><div className="recall-session-utilities">
      {languageHasAudio(props.language) ? <button aria-expanded={showPlaybackSettings} aria-label="Voice settings" className={showPlaybackSettings ? "is-active" : ""}
        onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Voice settings" type="button"><Settings2 size={18} /></button> : null}
      <button aria-label="End session" onClick={() => dispatch({ type: "reset" })} title="End session" type="button"><X size={18} /></button>
    </div>
      {languageHasAudio(props.language) && showPlaybackSettings ? <div aria-label="Voice settings" className="recall-session-playback-settings">
        <PlaybackSettings elevenLabs={props.elevenLabs} language={props.language} onPlayback={props.onPlayback}
          playback={props.playback} voices={props.voices} />
        <small>Changes apply to the next card.</small>
      </div> : null}
    </div>
  </section>;
}
