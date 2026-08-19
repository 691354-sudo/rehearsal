import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Play,
  Repeat2,
  Settings2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import {
  moveDrillItem,
  reconcileDrillOrder,
  sortPracticeItems,
  type DrillDirection,
  type PracticeSort,
} from "../../lib/drillQueue";
import { speedRangeForProvider } from "../../lib/playbackSettings";
import {
  moveReviewRating,
  reviewRatings,
  type ReviewRating,
} from "../../lib/sessionQueue";
import { DrillBar } from "./DrillBar";
import { loadDrillPreferences, saveDrillPreferences } from "./drillPreferences";
import { apiPath, capitalize, languageCopy } from "../../shared/config";
import type {
  AttemptDraft,
  DailyProgress,
  ElevenLabsConfig,
  ItemPreference,
  Language,
  LearningItem,
  Mode,
  PlaybackPreferences,
} from "../../shared/contracts";

type DrillStatus = "idle" | "loading" | "playing" | "paused" | "complete" | "error";

export function PracticePage(props: {
  activeItemId: string;
  attempts: Record<string, AttemptDraft>;
  dueItemIds: string[];
  items: LearningItem[];
  language: Language;
  mode: Mode;
  dailyProgress: DailyProgress;
  elevenLabs: ElevenLabsConfig;
  onActivate: (itemId: string) => void;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onMode: (mode: Mode) => void;
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: (item: LearningItem) => void;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPreference: (itemId: string, preference: ItemPreference) => void;
  onPlay: (text: string) => void;
  onRecallReview: (itemId: string, rating: ReviewRating) => void;
  onReveal: (publicId: string) => void;
  onShadowNext: (itemId: string) => void;
  onStopPlayback: () => void;
  playback: PlaybackPreferences;
  revealedItems: string[];
  openaiConfigured: boolean;
  voices: string[];
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const initialDrillPreferences = useMemo(() => loadDrillPreferences(props.language), [props.language]);
  const [topicFilters, setTopicFilters] = useState(initialDrillPreferences.topics);
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [practiceScope, setPracticeScope] = useState(initialDrillPreferences.scope);
  const [practiceSort, setPracticeSort] = useState<PracticeSort>(initialDrillPreferences.sort);
  const [drillOrder, setDrillOrder] = useState(initialDrillPreferences.order);
  const [drillLoopIds, setDrillLoopIds] = useState(initialDrillPreferences.loopIds);
  const [arrangingDrill, setArrangingDrill] = useState(false);
  const [drillState, setDrillState] = useState<{ status: DrillStatus; currentId: string }>({ status: "idle", currentId: "" });
  const [selectedRatings, setSelectedRatings] = useState<Record<string, ReviewRating>>({});
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const targetCode = languageCopy[props.language].short;
  const targetLabel = languageCopy[props.language].label;
  const goal = 100;
  const progress = Math.min(100, (props.dailyProgress.recall / goal) * 100);
  const topics = useMemo(() => [...new Set(props.items.flatMap((item) => item.tags.slice(0, 1)))].filter(Boolean).sort(), [props.items]);
  const dueItemSet = useMemo(() => new Set(props.dueItemIds), [props.dueItemIds]);
  const scopedItems = useMemo(() => practiceScope === "due"
    ? props.items.filter((item) => dueItemSet.has(item.publicId)) : props.items,
  [dueItemSet, practiceScope, props.items]);
  const orderedItems = useMemo(() => sortPracticeItems(
    scopedItems, drillOrder, practiceSort, props.dueItemIds,
  ), [drillOrder, practiceSort, props.dueItemIds, scopedItems]);
  const visibleItems = useMemo(() => orderedItems.filter((item) =>
    (!topicFilters.length || topicFilters.includes(item.tags[0] || "")) &&
    (frequencyFilter === "all" || (item.frequencyBand || "common") === frequencyFilter)),
  [frequencyFilter, orderedItems, topicFilters]);
  const drillActive = ["loading", "playing", "paused"].includes(drillState.status);
  const speedRange = speedRangeForProvider(props.playback.provider, props.elevenLabs.speedRange);

  useEffect(() => {
    saveDrillPreferences(props.language, {
      order: reconcileDrillOrder(props.items.map((item) => item.publicId), drillOrder),
      loopIds: drillLoopIds,
      topics: topicFilters,
      scope: practiceScope,
      sort: practiceSort,
    });
  }, [drillLoopIds, drillOrder, practiceScope, practiceSort, props.items, props.language, topicFilters]);

  const updateDrillState = useCallback((status: DrillStatus, currentId: string) => {
    setDrillState((current) => current.status === status && current.currentId === currentId
      ? current : { status, currentId });
  }, []);
  const toggleTopic = (topic: string) => setTopicFilters((current) => current.includes(topic)
    ? current.filter((value) => value !== topic) : [...current, topic]);
  const toggleLoop = (itemId: string) => setDrillLoopIds((current) => current.includes(itemId)
    ? current.filter((value) => value !== itemId) : [...current, itemId]);
  const moveDrillCard = (itemId: string, direction: DrillDirection) => {
    setDrillOrder((current) => moveDrillItem(
      reconcileDrillOrder(props.items.map((item) => item.publicId), current),
      visibleItems.map((item) => item.publicId),
      itemId,
      direction,
    ));
  };

  const activeHasEvaluation = Boolean(props.attempts[props.activeItemId]?.evaluation);
  useEffect(() => {
    if (props.mode !== "recall") return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-practice-input="${props.activeItemId}"]`)?.focus();
    });
  }, [activeHasEvaluation, props.activeItemId, props.items, props.mode]);

  return <main className="simple-main simple-main--practice">
    <header className="simple-practice-toolbar">
      <div className="simple-practice-title">
        <h1>Practice</h1>
        <div aria-label={`${props.dailyProgress.recall} of ${goal} recall attempts today`} className="simple-daily-progress">
          <span><strong>{props.dailyProgress.recall}</strong> / {goal} recall · {props.dailyProgress.shadow} shadow</span>
          <i><b style={{ width: `${progress}%` }} /></i>
        </div>
      </div>
      <div className="simple-feed-tools">
        <button
          aria-label={`Switch to ${props.mode === "recall" ? `${targetCode} to RU shadowing` : `RU to ${targetCode} recall`}`}
          className="simple-direction-toggle"
          onClick={() => props.onMode(props.mode === "recall" ? "shadow" : "recall")}
          type="button"
        >
          <span>{props.mode === "recall" ? "RU" : targetCode}</span>
          <span className="simple-direction-track"><ArrowRight size={13} /></span>
          <span>{props.mode === "recall" ? targetCode : "RU"}</span>
        </button>
        <div className="simple-filter-wrap"><button aria-expanded={filtersOpen}
          aria-label={`Choose cards. ${visibleItems.length} of ${props.items.length} shown`}
          className="simple-filter-button" disabled={drillActive} onClick={() => setFiltersOpen((open) => !open)} type="button">
          {!topicFilters.length ? practiceScope === "all" ? "All cards" : `${props.dueItemIds.length} due`
            : topicFilters.length === 1 ? topicFilters[0] : `${topicFilters.length} topics`} <ChevronDown size={14} /></button>
          {filtersOpen ? <div className="simple-filter-popover">
            <label>Cards<select onChange={(event) => setPracticeScope(event.target.value as "all" | "due")} value={practiceScope}>
              <option value="all">All Library cards ({props.items.length})</option>
              <option value="due">Due now ({props.dueItemIds.length})</option>
            </select></label>
            <label>Sort<select onChange={(event) => setPracticeSort(event.target.value as PracticeSort)} value={practiceSort}>
              <option value="manual">Manual order</option><option value="due-first">Due first</option>
              <option value="new-first">New first</option><option value="alphabetical">A–Z</option>
            </select></label>
            <fieldset><legend>Topics</legend><div className="simple-topic-checks">
            {topics.map((topic) => <label key={topic}><input checked={topicFilters.includes(topic)} onChange={() => toggleTopic(topic)} type="checkbox" /><span>{topic}</span></label>)}
          </div></fieldset>
            <label>Frequency<select onChange={(event) => setFrequencyFilter(event.target.value)} value={frequencyFilter}>
              <option value="all">Any frequency</option><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
            </select></label><button onClick={() => {
              setPracticeScope("all"); setPracticeSort("manual"); setTopicFilters([]); setFrequencyFilter("all"); setFiltersOpen(false);
            }} type="button">Reset</button></div> : null}</div>
        <button aria-label="Practice settings" className="simple-icon-button" onClick={() => setSettingsOpen((open) => !open)} type="button">
          <Settings2 size={17} />
        </button>
      </div>
    </header>

    <section aria-label="Drill controls" className="simple-practice-controls">
      <DrillBar arranging={arrangingDrill} elevenLabsConfigured={props.elevenLabs.configured}
        elevenLabsVoiceId={props.elevenLabs.voice.id} items={visibleItems} language={props.language}
        loopIds={drillLoopIds} onArrange={() => {
          setPracticeSort("manual"); setArrangingDrill((current) => !current);
        }}
        onBeforeStart={props.onStopPlayback} onSettings={() => setSettingsOpen((open) => !open)}
        onState={updateDrillState} openaiConfigured={props.openaiConfigured} playback={props.playback} />

      {settingsOpen ? <section aria-label="Playback settings" className="simple-inline-settings">
      <header><div><strong>Playback</strong><small>
        {props.playback.provider === "elevenlabs" ? `ElevenLabs · ${props.elevenLabs.voice.name}` : `OpenAI · ${capitalize(props.playback.voice)}`}
        {` · shared with Settings`}
      </small></div>
        <button onClick={() => setSettingsOpen(false)} type="button">Done</button></header>
      <div className="simple-playback-options">
        <div className="simple-playback-setting"><span>Repeats</span><div>
          {[1, 2, 3, 5].map((value) => <button className={props.playback.repetitions === value ? "is-active" : ""}
            key={value} onClick={() => props.onPlayback({ ...props.playback, repetitions: value })} type="button">{value}×</button>)}
        </div></div>
        <label className="simple-playback-setting simple-speed-setting"><span>Speed <strong>{props.playback.speed.toFixed(2)}× · {speedRange.min}–{speedRange.max}</strong></span>
          <input aria-label="Playback speed" max={speedRange.max} min={speedRange.min} onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })}
            step="0.05" type="range" value={props.playback.speed} /></label>
        <div className="simple-playback-setting"><span>Pause</span><div>
          {[500, 1500, 3000].map((value) => <button className={props.playback.pauseMs === value ? "is-active" : ""}
            key={value} onClick={() => props.onPlayback({ ...props.playback, pauseMs: value })} type="button">{value / 1000}s</button>)}
        </div></div>
      </div>
      </section> : null}
    </section>

    <div className="simple-feed-heading"><div><strong>Cards</strong><span>{visibleItems.length} shown from {props.items.length} in Library</span></div>
      <span>{practiceSort === "manual" ? "Manual order" : practiceSort === "due-first" ? "Due first" : practiceSort === "new-first" ? "New first" : "A–Z"}</span></div>

    <section className="simple-island-feed" aria-label="Practice feed">
      {!visibleItems.length ? <p className="simple-feed-empty">Nothing matches these filters.</p> : null}
      {visibleItems.map((feedItem) => {
        const isCurrent = feedItem.publicId === props.activeItemId;
        const isRevealed = props.revealedItems.includes(feedItem.publicId);
        const attempt = props.attempts[feedItem.publicId] || { answer: "" };
        const grade = selectedRatings[feedItem.publicId] || "good";
        const topic = feedItem.tags[0] || feedItem.source || "Personal";
        const isDrillCurrent = feedItem.publicId === drillState.currentId;
        const isLooped = drillLoopIds.includes(feedItem.publicId);
        const visibleIndex = visibleItems.findIndex((item) => item.publicId === feedItem.publicId);

        return <article className={`simple-island-card${isCurrent ? " is-current" : ""}${isDrillCurrent ? " is-drill-current" : ""}`} key={feedItem.publicId}>
          <div className="simple-island-prompt">
            <p>{props.mode === "recall" ? feedItem.cue : feedItem.target}</p>
            <button aria-label="Play phrase" className="simple-card-play" disabled={drillActive} onClick={() => props.onPlay(feedItem.target)} type="button">
              <Play fill="currentColor" size={15} />
            </button>
          </div>

          {props.mode === "recall" ? <>
            <div className="simple-card-input-row">
              <input
                data-practice-input={feedItem.publicId}
                onChange={(event) => { if (!attempt.evaluation) props.onAnswer(feedItem.publicId, event.target.value); }}
                onFocus={() => props.onActivate(feedItem.publicId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (attempt.evaluation) props.onRecallReview(feedItem.publicId, grade);
                    else props.onCheck(feedItem.publicId);
                    return;
                  }
                  if (attempt.evaluation && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                    setSelectedRatings((current) => ({
                      ...current,
                      [feedItem.publicId]: moveReviewRating(grade, direction),
                    }));
                  }
                }}
                placeholder={`Type in ${targetLabel}`}
                readOnly={Boolean(attempt.evaluation)}
                value={attempt.answer}
              />
              {!attempt.evaluation ? <button aria-label="Check phrase" className="simple-primary simple-card-check" disabled={!attempt.answer.trim()} onClick={() => props.onCheck(feedItem.publicId)} title="Check · Enter" type="button">
                <Check size={15} />
              </button> : null}
            </div>

            {attempt.evaluation ? <div className={`simple-inline-result simple-inline-result--${attempt.evaluation.verdict}`}>
              <div className="simple-inline-answer">
                <span>{attempt.evaluation.verdict === "exact" ? "Correct" : "Compare"}</span>
                {attempt.evaluation.verdict === "exact" ? <p>{attempt.evaluation.correctedAnswer}</p> : <div className="simple-word-diff">
                  <p aria-label="Your answer">{attempt.evaluation.answerTokens?.map((token, tokenIndex) =>
                    token.status === "extra" ? <del key={`${token.value}-${tokenIndex}`}>{token.value}</del> : <span key={`${token.value}-${tokenIndex}`}>{token.value}</span>)}</p>
                  <p aria-label="Natural version">{attempt.evaluation.expectedTokens?.map((token, tokenIndex) =>
                    token.status === "missing" ? <strong key={`${token.value}-${tokenIndex}`}>{token.value}</strong> : <span key={`${token.value}-${tokenIndex}`}>{token.value}</span>)}</p>
                </div>}
              </div>
              {attempt.evaluation.mistakes.map((mistake) => <p className="simple-inline-mistake" key={`${mistake.original}-${mistake.correction}`}>
                <del>{mistake.original}</del><ArrowRight size={13} /><strong>{mistake.correction}</strong>
                {mistake.explanationRu ? <small>{mistake.explanationRu}</small> : null}
              </p>)}
              <div className="simple-memory-grades" aria-label="Memory grade">
                {reviewRatings.map((rating) => <button
                  aria-pressed={rating === grade}
                  className={rating === grade ? "is-default" : ""}
                  key={rating}
                  onClick={() => props.onRecallReview(feedItem.publicId, rating)}
                  title={gradeTitle[rating]}
                  type="button"
                ><span>{capitalize(rating)}</span><small>{formatInterval(feedItem.schedule?.options[rating].intervalSeconds)}</small></button>)}
              </div>
            </div> : null}
          </> : null}

          {isCurrent && props.mode === "shadow" ? <div className="simple-shadow-next">
            <button aria-label="Next phrase" onClick={() => props.onShadowNext(feedItem.publicId)} title="Next phrase" type="button">
              <ChevronRight size={17} />
            </button>
          </div> : null}

          <footer className="simple-island-footer">
            <span>
              {props.mode === "shadow" || !attempt.evaluation ? <button className="simple-reveal" onClick={() => props.onReveal(feedItem.publicId)} type="button">
                {isRevealed ? "Hide" : props.mode === "recall" ? `Show in ${targetCode}` : "Show in RU"}
              </button> : null}
              {isRevealed ? <span className="simple-revealed-copy">{props.mode === "recall" ? feedItem.target : feedItem.cue}</span> : null}
            </span>
            {arrangingDrill ? <div className="simple-drill-card-tools" aria-label="Drill order">
              <button aria-label="Move card up" disabled={visibleIndex === 0 || drillActive} onClick={() => moveDrillCard(feedItem.publicId, -1)} title="Move up" type="button"><ArrowUp size={14} /></button>
              <button aria-label="Move card down" disabled={visibleIndex === visibleItems.length - 1 || drillActive} onClick={() => moveDrillCard(feedItem.publicId, 1)} title="Move down" type="button"><ArrowDown size={14} /></button>
              <button aria-label={isLooped ? "Remove card from loop" : "Repeat card on loop"} aria-pressed={isLooped}
                className={isLooped ? "is-active" : ""} disabled={drillActive} onClick={() => toggleLoop(feedItem.publicId)} title="Repeat on loop" type="button">
                <Repeat2 size={14} /><span>Loop</span>
              </button>
            </div> : null}
            <div className="simple-card-meta">
              <div aria-label="Card preference" className="simple-preference-actions">
                <button aria-label="Like this card" aria-pressed={feedItem.preference === "like"}
                  className={feedItem.preference === "like" ? "is-active" : ""}
                  onClick={() => props.onPreference(feedItem.publicId, feedItem.preference === "like" ? "neutral" : "like")}
                  title="Like" type="button"><ThumbsUp size={14} /></button>
                <button aria-label="Dislike this card" aria-pressed={feedItem.preference === "dislike"}
                  className={feedItem.preference === "dislike" ? "is-active" : ""}
                  onClick={() => props.onPreference(feedItem.publicId, feedItem.preference === "dislike" ? "neutral" : "dislike")}
                  title="Dislike" type="button"><ThumbsDown size={14} /></button>
              </div>
              <span><i />{topic}<small>{feedItem.schedule?.state || feedItem.status}</small></span>
              <button aria-label={`Edit ${feedItem.target}`} className="simple-card-edit" onClick={() => setEditingItem(feedItem)}
                title="Edit card" type="button"><Pencil size={13} /><span>Edit</span></button>
            </div>
          </footer>
        </article>;
      })}
    </section>
    {editingItem ? <PracticeItemEditor item={editingItem} language={props.language}
      onClose={() => setEditingItem(null)} onDeleted={(itemId) => { setEditingItem(null); props.onItemDeleted(itemId); }}
      onUpdated={(item) => { setEditingItem(null); props.onItemUpdated(item); }} /> : null}
  </main>;
}

function PracticeItemEditor(props: {
  item: LearningItem;
  language: Language;
  onClose: () => void;
  onDeleted: (itemId: string) => void;
  onUpdated: (item: LearningItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cue, setCue] = useState(props.item.cue);
  const [target, setTarget] = useState(props.item.target);
  const [note, setNote] = useState(props.item.note);
  const [category, setCategory] = useState(props.item.tags[0] || "");
  const [frequencyBand, setFrequencyBand] = useState(props.item.frequencyBand || "common");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const save = async () => {
    if (!cue.trim() || !target.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const secondaryTags = props.item.tags.slice(1);
      const response = await fetch(apiPath(`/api/items/${encodeURIComponent(props.item.publicId)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cue: cue.trim(),
          target: target.trim(),
          note: note.trim(),
          tags: category.trim() ? [category.trim(), ...secondaryTags] : secondaryTags,
          frequencyBand,
        }),
      });
      if (!response.ok) throw new Error("Could not save this card");
      const data = await response.json() as { item: LearningItem };
      props.onUpdated(data.item);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save this card");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this card from your library and practice history?")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(apiPath(`/api/items/${encodeURIComponent(props.item.publicId)}`), { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this card");
      props.onDeleted(props.item.publicId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete this card");
      setSaving(false);
    }
  };

  return <dialog aria-labelledby="practice-item-editor-title" className="simple-card-dialog" onCancel={(event) => {
    event.preventDefault(); props.onClose();
  }} onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }} ref={dialogRef}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="practice-item-editor-title">Edit card</h2><span>{props.item.source || "Personal library"}</span></div>
        <button aria-label="Close editor" onClick={props.onClose} type="button"><X size={17} /></button></header>
      <div className="simple-card-dialog-fields">
        <label><span>Russian cue</span><textarea autoFocus onChange={(event) => setCue(event.target.value)} rows={3} value={cue} /></label>
        <label><span>{languageCopy[props.language].label}</span><textarea onChange={(event) => setTarget(event.target.value)} rows={3} value={target} /></label>
        <label><span>Note</span><textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
        <div className="simple-card-dialog-row">
          <label><span>Category</span><input onChange={(event) => setCategory(event.target.value)} value={category} /></label>
          <label><span>Frequency</span><select onChange={(event) => setFrequencyBand(event.target.value as NonNullable<LearningItem["frequencyBand"]>)} value={frequencyBand}>
            <option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
          </select></label>
        </div>
        {error ? <p className="simple-card-dialog-error" role="alert">{error}</p> : null}
      </div>
      <footer><button className="simple-card-dialog-delete" disabled={saving} onClick={() => void remove()} type="button"><Trash2 size={14} />Delete</button>
        <div><button disabled={saving} onClick={props.onClose} type="button">Cancel</button>
          <button className="simple-primary" disabled={saving || !cue.trim() || !target.trim()} type="submit">{saving ? "Saving…" : "Save"}</button></div></footer>
    </form>
  </dialog>;
}


const gradeTitle: Record<ReviewRating, string> = {
  again: "Forgot",
  hard: "Recalled with hesitation",
  good: "Recalled",
  easy: "Immediate recall",
};

const formatInterval = (seconds?: number) => {
  if (seconds === undefined) return "";
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};
