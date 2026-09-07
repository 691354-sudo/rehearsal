import type { ComponentProps, ReactNode } from "react";
import { Play, Settings2, Shuffle } from "lucide-react";
import type { ListenRepeat } from "./ListenRepeat";
import type { LearningItem } from "../../shared/contracts";
import type { PracticeCardCount, PracticeOrder } from "../../lib/appRoute";
import type { PracticeScope } from "./practiceSelection";
import type { RepeatMode } from "../audio/listenAudio";
import { TopicProgressPicker } from "./TopicProgressPicker";
import { RepeatModeButton } from "./RepeatModeButton";
import { PracticeQueuePreview } from "./PracticeQueuePreview";

export function ListenSetup({ props, visibleCandidates, visibleComposition, playbackSettings,
  showPlaybackSettings, setShowPlaybackSettings, repeatMode, cycleRepeat, shuffle, start }: {
  props: ComponentProps<typeof ListenRepeat>;
  visibleCandidates: LearningItem[];
  visibleComposition: { due: number; new: number };
  playbackSettings: ReactNode;
  showPlaybackSettings: boolean;
  setShowPlaybackSettings: (update: (shown: boolean) => boolean) => void;
  repeatMode: RepeatMode;
  cycleRepeat: () => void;
  shuffle: () => void;
  start: () => Promise<void>;
}) {
  return <div className="practice-ready-layout">
    <section className="listen-setup" aria-label="Listen and Repeat setup">
      <div className={`listen-selection-grid${props.scope === "custom" ? " has-order" : ""}`}>
        <div className="practice-topic-field"><TopicProgressPicker onChange={props.onTopic} progressPill topics={props.topics} value={props.topicId} /></div>
        <label><span className="simple-visually-hidden">Cards</span><select aria-label="Practice cards" className="practice-card-select" name="listen-count" onChange={(event) => {
          const [scope, count] = event.target.value.split(":") as [PracticeScope, PracticeCardCount];
          props.onSelection(scope, count);
        }} value={`${props.scope}:${props.count}`}>
          <option value="due:all">All recommended</option><option value="due:10">10 recommended</option><option value="due:20">20 recommended</option><option value="due:50">50 recommended</option>
          <option value="custom:all">All Library</option><option value="custom:10">10 from Library</option><option value="custom:20">20 from Library</option><option value="custom:50">50 from Library</option>
        </select></label>
        {props.scope === "custom" ? <label><span className="simple-visually-hidden">Order</span><select aria-label="Card order" className="practice-order-select" name="listen-order"
          onChange={(event) => props.onOrder(event.target.value as PracticeOrder)} value={props.order}>
          <option value="original">{props.topicId ? "Original order" : "Oldest first"}</option><option value="newest">Newest first</option></select></label> : null}
      </div>
      {showPlaybackSettings ? <div className="listen-setup-playback">{playbackSettings}</div> : null}
      <div className="listen-start-options">
        <RepeatModeButton mode={repeatMode} onClick={cycleRepeat} size={17} />
        <button aria-label="Shuffle cards" onClick={shuffle} title="Shuffle" type="button"><Shuffle size={17} /></button>
        <button aria-expanded={showPlaybackSettings} aria-label="Playback settings" className={showPlaybackSettings ? "is-active" : ""}
          onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Playback settings" type="button"><Settings2 size={17} /></button>
        <span>{visibleComposition.due} due · {visibleComposition.new} not recalled yet</span>
      </div>
    </section>
    <button className="simple-primary listen-start" disabled={!visibleCandidates.length} onClick={() => void start()} type="button">
      <Play fill="currentColor" size={15} />Play {visibleCandidates.length || "recommended"} cards
    </button>
    <PracticeQueuePreview emptyAction={props.emptyAction} items={visibleCandidates} language={props.language} mode="listen" onEdit={props.onEdit}
      onListened={props.onListened} onPlay={(item) => props.onPlay(item.target, props.playback)} scope={props.scope} />
  </div>;
}
