import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Square } from "lucide-react";
import type {
  ElevenLabsConfig,
  IslandSummary,
  Language,
  LearningItem,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";
import { PracticeQueuePreview } from "./PracticeQueuePreview";
import { PlaybackSettings } from "./PlaybackSettings";
import { buildPracticeSelection, type PracticeScope } from "./practiceSelection";
import type { PracticeCardCount } from "../../lib/appRoute";

type PlayerStatus = "playing" | "paused" | "error";

export function ListenRepeat(props: {
  count: PracticeCardCount;
  dueItemIds: string[];
  emptyAction: ReactNode;
  elevenLabs: ElevenLabsConfig;
  items: LearningItem[];
  language: Language;
  onCount: (count: PracticeCardCount) => void;
  onListened: (itemId: string) => Promise<void>;
  onEdit: (item: LearningItem) => void;
  onPause: () => void;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<PlaybackResult>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onResume: () => void;
  onScope: (scope: PracticeScope) => void;
  onStop: () => void;
  playback: PlaybackPreferences;
  selectedTopicItems: Set<string> | null;
  scope: PracticeScope;
  topics: IslandSummary[];
  topicId: string;
  onTopic: (topicId: string) => void;
  voices: string[];
}) {
  const [queue, setQueue] = useState<LearningItem[]>([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"setup" | "player" | "complete">("setup");
  const [status, setStatus] = useState<PlayerStatus>("playing");
  const [showRussian, setShowRussian] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [showPlaybackSettings, setShowPlaybackSettings] = useState(false);
  const [learnedInSession, setLearnedInSession] = useState<Set<string>>(new Set());
  const runRef = useRef(0);
  const pausedRef = useRef(false);
  const playbackRef = useRef(props.playback);
  playbackRef.current = props.playback;
  const actionsRef = useRef<Record<"play" | "pause" | "previous" | "next" | "stop", () => void>>({
    play: () => undefined,
    pause: () => undefined,
    previous: () => undefined,
    next: () => undefined,
    stop: () => undefined,
  });
  const countValue = props.count === "all" ? "all" : Number(props.count);
  const candidates = useMemo(() => buildPracticeSelection(
    props.items,
    props.dueItemIds,
    props.selectedTopicItems,
    countValue,
    props.scope,
  ), [countValue, props.dueItemIds, props.items, props.scope, props.selectedTopicItems]);
  const current = queue[index];
  const selectedElevenLabsVoice = props.elevenLabs.voices.find(
    (voice) => voice.id === props.playback.elevenlabs.voiceId,
  ) || props.elevenLabs.voice;
  const playbackSettings = <PlaybackSettings elevenLabs={props.elevenLabs} language={props.language}
    onPlayback={props.onPlayback} playback={props.playback} voices={props.voices} />;

  const playAt = async (nextIndex: number, nextQueue = queue, preservePause = false) => {
    const item = nextQueue[nextIndex];
    if (!item) { setPhase("complete"); return; }
    const run = runRef.current + 1;
    runRef.current = run;
    if (!preservePause) pausedRef.current = false;
    props.onStop();
    setQueue(nextQueue); setIndex(nextIndex); setPhase("player"); setStatus("playing"); setError("");
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.target,
        artist: "Rehearsal · Listen & Repeat",
        album: props.language === "en" ? "English" : "Latviešu",
      });
    }
    try {
      const activePlayback = playbackRef.current;
      const result = await props.onPlay(item.target, activePlayback);
      if (run !== runRef.current) return;
      setNote(result.provider === "browser" ? "Browser voice" : "");
      await props.onListened(item.publicId);
      if (run !== runRef.current) return;
      let remainingPause = nextIndex + 1 < nextQueue.length ? activePlayback.pauseMs : 0;
      while ((pausedRef.current || remainingPause > 0) && run === runRef.current) {
        const slice = pausedRef.current ? 80 : Math.min(80, remainingPause);
        await new Promise((resolve) => window.setTimeout(resolve, slice));
        if (!pausedRef.current) remainingPause -= slice;
      }
      if (run !== runRef.current) return;
      if (nextIndex + 1 < nextQueue.length) void playAt(nextIndex + 1, nextQueue, true);
      else setPhase("complete");
    } catch (caught) {
      if (run !== runRef.current) return;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Audio unavailable.");
    }
  };
  const stop = () => { runRef.current += 1; pausedRef.current = false; props.onStop(); setPhase("setup"); setError(""); setShowPlaybackSettings(false); };
  const previous = () => { if (queue.length) void playAt(Math.max(0, index - 1)); };
  const next = () => { if (index + 1 < queue.length) void playAt(index + 1); else { runRef.current += 1; props.onStop(); setPhase("complete"); } };
  const replay = () => { if (current) void playAt(index); };
  const pause = () => { pausedRef.current = true; props.onPause(); setStatus("paused"); };
  const resume = () => { pausedRef.current = false; props.onResume(); setStatus("playing"); };
  actionsRef.current = { play: resume, pause, previous, next, stop };

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => actionsRef.current.play());
    navigator.mediaSession.setActionHandler("pause", () => actionsRef.current.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => actionsRef.current.previous());
    navigator.mediaSession.setActionHandler("nexttrack", () => actionsRef.current.next());
    navigator.mediaSession.setActionHandler("stop", () => actionsRef.current.stop());
    return () => {
      for (const action of ["play", "pause", "previoustrack", "nexttrack", "stop"] as MediaSessionAction[]) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    };
  }, []);
  useEffect(() => () => { runRef.current += 1; props.onStop(); }, [props.onStop]);

  if (phase === "setup") return <div className="practice-ready-layout">
    <section className="listen-setup" aria-label="Listen and Repeat setup">
      <div className="practice-scope-switch" role="group" aria-label="Listening source">
        <button aria-pressed={props.scope === "due"} onClick={() => props.onScope("due")} type="button">Due now</button>
        <button aria-pressed={props.scope === "custom"} onClick={() => props.onScope("custom")} type="button">All Library</button>
      </div>
      <div className="listen-selection-grid">
        <label><span>Topic</span><select name="listen-topic" onChange={(event) => props.onTopic(event.target.value)} value={props.topicId}>
          <option value="">All Topics</option>{props.topics.map((topic) => <option key={topic.publicId} value={topic.publicId}>{topic.title}</option>)}
        </select></label>
        <label><span>Cards</span><select name="listen-count" onChange={(event) => props.onCount(event.target.value as PracticeCardCount)} value={props.count}>
          <option value="all">All {props.scope === "due" ? "due" : "matching"}</option><option value="10">10</option><option value="20">20</option><option value="50">50</option>
        </select></label>
      </div>
      <details className="listen-playback-options">
        <summary><span>Playback</span><strong>{props.playback.provider === "elevenlabs" ? selectedElevenLabsVoice.name : props.playback.voice} · {props.playback.speed.toFixed(2)}× · {props.playback.repetitions}× · {props.playback.pauseMs / 1000}s</strong></summary>
        {playbackSettings}
      </details>
      <button className="simple-primary listen-start" disabled={!candidates.length} onClick={() => void playAt(0, candidates)} type="button">
        <Play fill="currentColor" size={15} />Play {candidates.length || "due"} cards
      </button>
    </section>
    <PracticeQueuePreview emptyAction={props.emptyAction} items={candidates} language={props.language} mode="listen" onEdit={props.onEdit}
      onPlay={(item) => props.onPlay(item.target, props.playback)} scope={props.scope} />
  </div>;

  if (phase === "complete") return <section className="recall-complete" aria-label="Listening complete">
    <span>Listening complete</span><strong>{queue.length} listened</strong>
    <div><button className="simple-primary" onClick={() => void playAt(0)} type="button">Play again</button><button onClick={stop} type="button">Change selection</button></div>
  </section>;

  return <section className="listen-player" aria-label="Listen and Repeat player">
    <header><span>{index + 1} / {queue.length}</span><div>{note ? <small>{note}</small> : null}
      {current && current.practiceEnabled && !learnedInSession.has(current.publicId) ? <button onClick={async () => {
        if (await props.onPracticeEnabled(current.publicId, false)) {
          setLearnedInSession((ids) => new Set(ids).add(current.publicId)); setNote("Moved to Learned");
        }
      }} type="button">Move to Learned</button> : null}</div></header>
    <article><p lang={props.language}>{current?.target}</p>{showRussian ? <span lang="ru">{current?.cue}</span> : null}
      <button className="listen-russian" onClick={() => setShowRussian((shown) => !shown)} type="button">{showRussian ? "Hide Russian" : "Show Russian"}</button></article>
    <div className="listen-controls">
      <button aria-label="Previous" disabled={index === 0} onClick={previous} type="button"><SkipBack fill="currentColor" size={17} /></button>
      <button aria-label="Replay current" onClick={replay} type="button"><RotateCcw size={18} /></button>
      <button aria-label={status === "paused" ? "Play" : "Pause"} className="listen-main-control" onClick={status === "paused" ? resume : pause} type="button">
        {status === "paused" ? <Play fill="currentColor" size={19} /> : <Pause fill="currentColor" size={19} />}</button>
      <button aria-label="Next" onClick={next} type="button"><SkipForward fill="currentColor" size={17} /></button>
      <button aria-label="Stop" onClick={stop} type="button"><Square fill="currentColor" size={14} /></button>
      <button aria-expanded={showPlaybackSettings} aria-label="Voice settings" className={showPlaybackSettings ? "is-active" : ""}
        onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Voice settings" type="button"><Settings2 size={18} /></button>
    </div>
    {showPlaybackSettings ? <div className="listen-player-settings" aria-label="Voice settings">
      {playbackSettings}<small>Changes apply to the next card.</small>
    </div> : null}
    {error ? <p className="listen-error" role="alert">{error} <button onClick={replay} type="button">Retry</button></p> : null}
  </section>;
}
