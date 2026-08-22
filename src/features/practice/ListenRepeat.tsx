import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pause, Play, Repeat2, Settings2, Shuffle, SkipBack, SkipForward,
} from "lucide-react";
import type {
  ElevenLabsConfig,
  IslandSummary,
  Language,
  LearningItem,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";
import { apiFetch } from "../../shared/api";
import { languageCopy } from "../../shared/config";
import type { PracticeCardCount } from "../../lib/appRoute";
import {
  adaptivePauseMs,
  markListenedOnce,
  nextQueueIndex,
  playbackIdentity,
  preparationBody,
  shuffleQueue,
  type AudioPreparationJob,
  type PreparedAudio,
} from "../audio/listenAudio";
import { PracticeQueuePreview } from "./PracticeQueuePreview";
import { PlaybackSettings, voiceDisplayName } from "./PlaybackSettings";
import { FocusedText } from "../progress/FocusedText";
import { TopicProgressPicker } from "./TopicProgressPicker";
import { buildPracticeSelection, type PracticeScope } from "./practiceSelection";

type PlayerStatus = "playing" | "paused" | "error";

export function ListenRepeat(props: {
  count: PracticeCardCount;
  dueItemIds: string[];
  emptyAction: ReactNode;
  elevenLabs: ElevenLabsConfig;
  items: LearningItem[];
  language: Language;
  onSelection: (scope: PracticeScope, count: PracticeCardCount) => void;
  onListened: (itemId: string) => Promise<void>;
  recommended: { due: number; new: number };
  onEdit: (item: LearningItem) => void;
  onPause: () => void;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<PlaybackResult>;
  onPlayPrepared: (url: string, repetitions: number) => Promise<number>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPrepareAudio: (
    text: string,
    playback: Partial<PlaybackPreferences>,
    strictProvider: boolean,
  ) => Promise<PreparedAudio>;
  onResume: () => void;
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
  const [shuffledCandidates, setShuffledCandidates] = useState<LearningItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"setup" | "player" | "complete">("setup");
  const [status, setStatus] = useState<PlayerStatus>("playing");
  const [loop, setLoop] = useState(false);
  const [showRussian, setShowRussian] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [preparationError, setPreparationError] = useState("");
  const [readyCount, setReadyCount] = useState(0);
  const [preparationTotal, setPreparationTotal] = useState(0);
  const [showPlaybackSettings, setShowPlaybackSettings] = useState(false);
  const runRef = useRef(0);
  const preparationRunRef = useRef(0);
  const memoryRunRef = useRef(0);
  const preparationJobRef = useRef(new Set<string>());
  const preparationIdentityRef = useRef("");
  const pausedRef = useRef(false);
  const loopRef = useRef(loop);
  const playbackRef = useRef(props.playback);
  const queueRef = useRef(queue);
  const pendingShuffleRef = useRef<LearningItem[] | null>(null);
  const listenedRef = useRef(new Set<string>());
  const buffersRef = useRef(new Map<string, string>());
  const downloadsRef = useRef(new Map<string, Promise<string>>());
  const urlsRef = useRef(new Set<string>());
  playbackRef.current = props.playback;
  queueRef.current = queue;
  loopRef.current = loop;

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
  const visibleCandidates = shuffledCandidates || candidates;
  const current = queue[index];
  const compatibleElevenLabsVoices = props.elevenLabs.voicesByLanguage[props.language] || [];
  const selectedElevenLabsVoice = compatibleElevenLabsVoices.find(
    (voice) => voice.id === props.playback.elevenlabs.voiceId,
  ) || compatibleElevenLabsVoices[0] || { id: "", name: "No compatible voice" };
  const selectedVoiceName = voiceDisplayName(props.playback.provider === "elevenlabs"
    ? selectedElevenLabsVoice.name : props.playback.voice);
  const selectedTopicName = props.topics.find((topic) => topic.publicId === props.topicId)?.title || "All Topics";
  const playbackSettings = <PlaybackSettings elevenLabs={props.elevenLabs} language={props.language}
    onPlayback={props.onPlayback} playback={props.playback} voices={props.voices} />;

  const bufferKey = (item: LearningItem, playback: PlaybackPreferences) =>
    `${playbackIdentity(props.language, playback)}:${item.publicId}:${item.target}`;

  const refreshReadyCount = (playback: PlaybackPreferences, items = queueRef.current) => {
    setReadyCount(items.filter((item) => buffersRef.current.has(bufferKey(item, playback))).length);
  };

  const clearBuffers = () => {
    memoryRunRef.current += 1;
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current.clear();
    buffersRef.current.clear();
    downloadsRef.current.clear();
    setReadyCount(0);
    setPreparationTotal(0);
  };

  const cancelPreparation = (releaseBuffers = false) => {
    preparationRunRef.current += 1;
    for (const jobId of preparationJobRef.current) {
      void apiFetch(`/api/audio/prepare/${jobId}`, { method: "DELETE" }).catch(() => undefined);
    }
    preparationJobRef.current.clear();
    if (releaseBuffers) clearBuffers();
  };

  const ensureBuffered = (item: LearningItem, playback: PlaybackPreferences) => {
    const key = bufferKey(item, playback);
    const ready = buffersRef.current.get(key);
    if (ready) return Promise.resolve(ready);
    const downloading = downloadsRef.current.get(key);
    if (downloading) return downloading;
    const memoryRun = memoryRunRef.current;
    const download = props.onPrepareAudio(item.target, playback, true).then((prepared) => {
      const url = URL.createObjectURL(prepared.blob);
      if (memoryRun !== memoryRunRef.current) {
        URL.revokeObjectURL(url);
        throw new Error("Audio preparation was stopped.");
      }
      buffersRef.current.set(key, url);
      urlsRef.current.add(url);
      if (preparationIdentityRef.current === playbackIdentity(props.language, playback)) {
        refreshReadyCount(playback);
      }
      return url;
    }).finally(() => downloadsRef.current.delete(key));
    downloadsRef.current.set(key, download);
    return download;
  };

  const pumpPreparation = async (
    jobId: string,
    items: LearningItem[],
    playback: PlaybackPreferences,
    preparationRun: number,
  ) => {
    while (preparationRun === preparationRunRef.current) {
      const response = await apiFetch(`/api/audio/prepare/${jobId}`);
      if (!response.ok) throw new Error("Could not check audio preparation.");
      const job = await response.json() as AudioPreparationJob;
      if (preparationRun !== preparationRunRef.current) return;
      const readyIds = new Set(job.items.filter((item) => item.status === "ready").map((item) => item.itemId));
      const missing = items.filter((item) => readyIds.has(item.publicId)
        && !buffersRef.current.has(bufferKey(item, playback))).slice(0, 3);
      if (missing.length) {
        await Promise.allSettled(missing.map((item) => ensureBuffered(item, playback)));
      }
      refreshReadyCount(playback);
      const pocketReady = items.filter((item) => buffersRef.current.has(bufferKey(item, playback))).length;
      if (pocketReady === items.length || job.status === "cancelled") return;
      if (job.status === "failed") {
        const failed = job.items.find((item) => item.status === "failed");
        throw new Error(failed?.error || "Some audio could not be prepared.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, missing.length ? 0 : 400));
    }
  };

  const beginPreparation = async (
    items: LearningItem[],
    playback: PlaybackPreferences,
    priorityItem = items[0],
  ) => {
    cancelPreparation();
    setPreparationError("");
    setPreparationTotal(items.length);
    preparationIdentityRef.current = playbackIdentity(props.language, playback);
    refreshReadyCount(playback, items);
    const ordered = priorityItem
      ? [priorityItem, ...items.filter((item) => item.publicId !== priorityItem.publicId)] : items;
    const preparationRun = preparationRunRef.current;
    const chunks = Array.from({ length: Math.ceil(ordered.length / 50) }, (_, chunkIndex) =>
      ordered.slice(chunkIndex * 50, chunkIndex * 50 + 50));
    await Promise.all(chunks.map(async (chunk) => {
      const response = await apiFetch("/api/audio/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preparationBody(chunk.map((item) => item.publicId), props.language, playback)),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { message?: string; error?: string } | null;
        throw new Error(failure?.message || failure?.error || "Could not prepare this stack.");
      }
      const job = await response.json() as AudioPreparationJob;
      if (preparationRun !== preparationRunRef.current) {
        void apiFetch(`/api/audio/prepare/${job.jobId}`, { method: "DELETE" }).catch(() => undefined);
        return;
      }
      preparationJobRef.current.add(job.jobId);
      void pumpPreparation(job.jobId, chunk, playback, preparationRun).catch((caught) => {
        if (preparationRun === preparationRunRef.current) {
          setPreparationError(caught instanceof Error ? caught.message : "Audio preparation stopped.");
        }
      });
    }));
  };

  const waitForPause = async (pauseMs: number, run: number) => {
    let remaining = pauseMs;
    while (remaining > 0 && run === runRef.current) {
      const startedAt = Date.now();
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (!pausedRef.current) remaining -= Date.now() - startedAt;
    }
  };

  const playAt = async (nextIndex: number, nextQueue = queueRef.current, preservePause = false) => {
    const item = nextQueue[nextIndex];
    if (!item) { setPhase("complete"); return; }
    const run = runRef.current + 1;
    runRef.current = run;
    if (!preservePause) pausedRef.current = false;
    props.onStop();
    queueRef.current = nextQueue;
    setQueue(nextQueue);
    setIndex(nextIndex);
    setPhase("player");
    setStatus("playing");
    setError("");
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.target,
        artist: "Echo · Listen & Repeat",
        album: languageCopy[props.language].label,
      });
    }
    try {
      const activePlayback = playbackRef.current;
      const identity = playbackIdentity(props.language, activePlayback);
      if (identity !== preparationIdentityRef.current) {
        await beginPreparation(nextQueue, activePlayback, item);
      }
      const url = await ensureBuffered(item, activePlayback);
      if (run !== runRef.current) return;
      const durationMs = await props.onPlayPrepared(url, activePlayback.repetitions);
      if (run !== runRef.current) return;
      markListenedOnce(listenedRef.current, item.publicId, props.onListened);
      await waitForPause(adaptivePauseMs(durationMs), run);
      if (run !== runRef.current) return;
      const shuffled = pendingShuffleRef.current;
      if (shuffled) {
        pendingShuffleRef.current = null;
        setNote("");
        void playAt(0, shuffled, true);
      } else {
        const followingIndex = nextQueueIndex(nextIndex, nextQueue.length, loopRef.current);
        if (followingIndex === null) setPhase("complete");
        else void playAt(followingIndex, nextQueue, true);
      }
    } catch (caught) {
      if (run !== runRef.current) return;
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Audio unavailable.");
    }
  };

  const start = async () => {
    const nextQueue = visibleCandidates;
    if (!nextQueue.length) return;
    listenedRef.current.clear();
    queueRef.current = nextQueue;
    setQueue(nextQueue);
    setIndex(0);
    setPhase("player");
    try {
      await beginPreparation(nextQueue, playbackRef.current, nextQueue[0]);
      void playAt(0, nextQueue);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Could not prepare this stack.");
    }
  };

  const stop = () => {
    runRef.current += 1;
    pausedRef.current = false;
    pendingShuffleRef.current = null;
    props.onStop();
    cancelPreparation(true);
    setPhase("setup");
    setError("");
    setPreparationError("");
    setShowPlaybackSettings(false);
  };
  const restart = () => {
    listenedRef.current.clear();
    void playAt(0);
  };
  const previous = () => {
    if (!queue.length) return;
    const previousIndex = index > 0 ? index - 1 : loopRef.current ? queue.length - 1 : 0;
    void playAt(previousIndex);
  };
  const next = () => {
    const nextIndex = nextQueueIndex(index, queue.length, loopRef.current);
    if (nextIndex !== null) void playAt(nextIndex);
    else { runRef.current += 1; props.onStop(); setPhase("complete"); }
  };
  const replay = () => { if (current) void playAt(index); };
  const pause = () => { pausedRef.current = true; props.onPause(); setStatus("paused"); };
  const resume = () => { pausedRef.current = false; props.onResume(); setStatus("playing"); };
  const shuffle = () => {
    if (phase === "setup") setShuffledCandidates(shuffleQueue(candidates));
    else {
      pendingShuffleRef.current = shuffleQueue(queue);
      setNote("Shuffle starts after this card");
    }
  };
  actionsRef.current = { play: resume, pause, previous, next, stop };

  useEffect(() => setShuffledCandidates(null), [candidates]);
  useEffect(() => {
    if (phase !== "player") return;
    const identity = playbackIdentity(props.language, props.playback);
    if (!preparationIdentityRef.current || identity === preparationIdentityRef.current) return;
    void beginPreparation(queueRef.current, props.playback, queueRef.current[index]).catch((caught) => {
      setPreparationError(caught instanceof Error ? caught.message : "Could not prepare updated audio.");
    });
  }, [phase, props.language, props.playback]);
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
  useEffect(() => () => {
    runRef.current += 1;
    props.onStop();
    cancelPreparation(true);
  }, [props.onStop]);

  if (phase === "setup") return <div className="practice-ready-layout">
    <section className="listen-setup" aria-label="Listen and Repeat setup">
      <div className="listen-selection-grid">
        <label><span className="simple-visually-hidden">Topic</span><TopicProgressPicker onChange={props.onTopic} progressPill topics={props.topics} value={props.topicId} /></label>
        <label><span className="simple-visually-hidden">Cards</span><select aria-label="Practice cards" className="practice-card-select" name="listen-count" onChange={(event) => {
          const [scope, count] = event.target.value.split(":") as [PracticeScope, PracticeCardCount];
          props.onSelection(scope, count);
        }} value={`${props.scope}:${props.count}`}>
          <option value="due:all">All recommended</option><option value="due:10">10 recommended</option><option value="due:20">20 recommended</option><option value="due:50">50 recommended</option>
          <option value="custom:all">All Library</option><option value="custom:10">10 from Library</option><option value="custom:20">20 from Library</option><option value="custom:50">50 from Library</option>
        </select></label>
      </div>
      {showPlaybackSettings ? <div className="listen-setup-playback">{playbackSettings}</div> : null}
      <div className="listen-start-options">
        <button aria-label={loop ? "Disable loop" : "Enable loop"} aria-pressed={loop} className={loop ? "is-active" : ""} onClick={() => setLoop((enabled) => !enabled)} title="Loop" type="button"><Repeat2 size={17} /></button>
        <button aria-label="Shuffle cards" onClick={shuffle} title="Shuffle" type="button"><Shuffle size={17} /></button>
        <button aria-expanded={showPlaybackSettings} aria-label="Playback settings" className={showPlaybackSettings ? "is-active" : ""}
          onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Playback settings" type="button"><Settings2 size={17} /></button>
        <span>{props.recommended.due} due · {props.recommended.new} new</span>
      </div>
    </section>
    <button className="simple-primary listen-start" disabled={!visibleCandidates.length} onClick={() => void start()} type="button">
      <Play fill="currentColor" size={15} />Play {visibleCandidates.length || "recommended"} cards
    </button>
    <PracticeQueuePreview emptyAction={props.emptyAction} items={visibleCandidates} language={props.language} mode="listen" onEdit={props.onEdit}
      onListened={props.onListened} onPlay={(item) => props.onPlay(item.target, props.playback)} scope={props.scope} />
  </div>;

  if (phase === "complete") return <section className="recall-complete" aria-label="Listening complete">
    <span>Listening complete</span><strong>{queue.length} listened</strong>
    <div><button className="simple-primary" onClick={restart} type="button">Play again</button><button onClick={stop} type="button">Change selection</button></div>
  </section>;

  return <section className="listen-player" aria-label="Listen and Repeat player">
    <header><span>{index + 1} / {queue.length}</span><div aria-hidden="true" className="listen-progress-track"><i style={{ width: `${queue.length ? ((index + 1) / queue.length) * 100 : 0}%` }} /></div>
      <strong>{selectedTopicName}</strong></header>
    <span className="simple-visually-hidden" role="status">Ready for pocket {readyCount} / {preparationTotal || queue.length}{note ? `. ${note}` : ""}</span>
    <article><span className="listen-prompt">Repeat after the speaker</span>
      <p lang={props.language}>{current ? <FocusedText focusTerms={current.focusTerms} text={current.target} /> : null}</p>{showRussian ? <span className="listen-russian-cue" lang="ru">{current?.cue}</span> : null}
      <button className="listen-russian" onClick={() => setShowRussian((shown) => !shown)} type="button">{showRussian ? "Hide Russian" : "Show Russian"}</button></article>
    <div className="listen-player-dock">
      <div className="listen-controls">
        <button aria-label="Shuffle after this card" onClick={shuffle} type="button"><Shuffle size={18} /></button>
        <button aria-label="Previous" disabled={index === 0 && !loop} onClick={previous} type="button"><SkipBack fill="currentColor" size={17} /></button>
        <button aria-label={status === "paused" ? "Play" : "Pause"} className="listen-main-control" onClick={status === "paused" ? resume : pause} type="button">
          {status === "paused" ? <Play fill="currentColor" size={19} /> : <Pause fill="currentColor" size={19} />}</button>
        <button aria-label="Next" onClick={next} type="button"><SkipForward fill="currentColor" size={17} /></button>
        <button aria-label={loop ? "Disable loop" : "Enable loop"} aria-pressed={loop} className={loop ? "is-active" : ""} onClick={() => setLoop((enabled) => !enabled)} type="button"><Repeat2 size={18} /></button>
        <button aria-expanded={showPlaybackSettings} aria-label="Voice settings" className={showPlaybackSettings ? "is-active" : ""}
          onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Voice settings" type="button"><Settings2 size={18} /></button>
      </div>
      <div className="listen-player-chips" aria-label="Current playback settings">
        <span>{props.playback.speed.toFixed(2)}×</span><span>Adaptive pause</span>
        <span>{selectedVoiceName}</span>
      </div>
    </div>
    {showPlaybackSettings ? <div className="listen-player-settings" aria-label="Voice settings">
      {playbackSettings}<small>Changes apply to the next card and prepare a new stack variant.</small>
    </div> : null}
    {preparationError ? <p className="listen-preparation-error" role="status">Pocket preparation paused. {preparationError} <button onClick={() => {
      void beginPreparation(queue, playbackRef.current, current).catch(() => undefined);
    }} type="button">Retry preparation</button></p> : null}
    {error ? <p className="listen-error" role="alert">{error} <button onClick={replay} type="button">Retry</button></p> : null}
  </section>;
}
