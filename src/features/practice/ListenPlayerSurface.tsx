import { useEffect, useRef, type ReactNode } from "react";
import { Pause, Pencil, Play, Settings2, Shuffle, SkipBack, SkipForward } from "lucide-react";
import type { Language, LearningItem, PlaybackPreferences } from "../../shared/contracts";
import { FocusedText } from "../progress/FocusedText";
import { RepeatModeButton } from "./RepeatModeButton";
import type { RepeatMode } from "../audio/listenAudio";

export function ListenPlayerSurface(props: {
  current: LearningItem;
  editActive: boolean;
  error: string;
  index: number;
  language: Language;
  note: string;
  onEdit: () => void;
  onNext: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onReplay: () => void;
  onResume: () => void;
  onRetryPreparation: () => void;
  onShuffle: () => void;
  onToggleRepeat: () => void;
  onToggleRussian: () => void;
  onToggleSettings: () => void;
  playback: PlaybackPreferences;
  playbackSettings: ReactNode;
  preparationError: string;
  preparationTotal: number;
  previousDisabled: boolean;
  queueLength: number;
  readyCount: number;
  repeatMode: RepeatMode;
  selectedTopicName: string;
  selectedVoiceName: string;
  showPlaybackSettings: boolean;
  showRussian: boolean;
  status: "playing" | "paused" | "error";
}) {
  const surfaceRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.editActive) return;
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== surfaceRef.current) active.blur();
      window.getSelection()?.removeAllRanges();
      surfaceRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.editActive]);
  return <section className={`listen-player${props.showPlaybackSettings ? " is-settings-open" : ""}`} aria-label="Listen and Repeat player"
    ref={surfaceRef} tabIndex={-1}>
    <header><span>{props.index + 1} / {props.queueLength}</span><div aria-hidden="true" className="listen-progress-track"><i style={{ width: `${props.queueLength ? ((props.index + 1) / props.queueLength) * 100 : 0}%` }} /></div>
      <strong>{props.selectedTopicName}</strong></header>
    <span className="simple-visually-hidden" role="status">Ready for pocket {props.readyCount} / {props.preparationTotal || props.queueLength}{props.note ? `. ${props.note}` : ""}</span>
    <article><div className="listen-prompt-row"><span className="listen-prompt">Repeat after the speaker</span>
      <button aria-label={`Edit ${props.current.target}`} className="practice-active-edit" onClick={props.onEdit} title="Edit card" type="button"><Pencil aria-hidden="true" size={14} /></button></div>
      <p lang={props.language}><FocusedText focusTerms={props.current.focusTerms} text={props.current.target} /></p>
      {props.showRussian ? <span className="listen-russian-cue" lang="ru">{props.current.cue}</span> : null}
      <button className="listen-russian" onClick={props.onToggleRussian} type="button">{props.showRussian ? "Hide Russian" : "Show Russian"}</button></article>
    <div className="listen-player-dock"><div className="listen-controls">
      <button aria-label="Shuffle after this card" onClick={props.onShuffle} type="button"><Shuffle aria-hidden="true" size={18} /></button>
      <button aria-label="Previous" disabled={props.previousDisabled} onClick={props.onPrevious} type="button"><SkipBack aria-hidden="true" fill="currentColor" size={17} /></button>
      <button aria-label={props.status === "paused" ? "Play" : "Pause"} className="listen-main-control" onClick={props.status === "paused" ? props.onResume : props.onPause} type="button">
        {props.status === "paused" ? <Play aria-hidden="true" fill="currentColor" size={19} /> : <Pause aria-hidden="true" fill="currentColor" size={19} />}</button>
      <button aria-label="Next" onClick={props.onNext} type="button"><SkipForward aria-hidden="true" fill="currentColor" size={17} /></button>
      <RepeatModeButton mode={props.repeatMode} onClick={props.onToggleRepeat} size={18} />
      <button aria-expanded={props.showPlaybackSettings} aria-label="Voice settings" className={props.showPlaybackSettings ? "is-active" : ""}
        onClick={props.onToggleSettings} title="Voice settings" type="button"><Settings2 aria-hidden="true" size={18} /></button>
    </div><div className="listen-player-chips" aria-label="Current playback settings">
      <span>{props.playback.speed.toFixed(2)}×</span><span>Adaptive pause</span><span>{props.selectedVoiceName}</span>
    </div></div>
    {props.showPlaybackSettings ? <div className="listen-player-settings" aria-label="Voice settings">
      {props.playbackSettings}<small>Changes apply to the next card and prepare a new stack variant.</small>
    </div> : null}
    {props.preparationError ? <p className="listen-preparation-error" role="status">Pocket preparation paused. {props.preparationError} <button onClick={props.onRetryPreparation} type="button">Retry preparation</button></p> : null}
    {props.error ? <p className="listen-error" role="alert">{props.error} <button onClick={props.onReplay} type="button">Retry</button></p> : null}
  </section>;
}
