import {usePilot} from "../pilot/PilotProvider";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Play, Settings2 } from "lucide-react";
import { ShuffleButton } from "./ShuffleButton";
import type { ListenRepeat } from "./ListenRepeat";
import type { LearningItem } from "../../shared/contracts";
import type { PracticeCardCount, PracticeOrder } from "../../lib/appRoute";
import type { PracticeScope } from "./practiceSelection";
import type { RepeatMode } from "../audio/listenAudio";
import { TopicProgressPicker } from "./TopicProgressPicker";
import { RepeatModeButton } from "./RepeatModeButton";
import { PracticeQueuePreview } from "./PracticeQueuePreview";
import { RecommendationStatus } from "./RecommendationStatus";
import type { useListenRecommendations } from "./useListenRecommendations";

export function ListenSetup({ props, recommendations, visibleCandidates, visibleComposition, playbackSettings,
  showPlaybackSettings, setShowPlaybackSettings, repeatMode, cycleRepeat, shuffleEnabled, shuffle, start }: {
  props: ComponentProps<typeof ListenRepeat>;
  recommendations: ReturnType<typeof useListenRecommendations>;
  visibleCandidates: LearningItem[];
  visibleComposition: { due: number; new: number };
  playbackSettings: ReactNode;
  showPlaybackSettings: boolean;
  setShowPlaybackSettings: (update: (shown: boolean) => boolean) => void;
  repeatMode: RepeatMode;
  cycleRepeat: () => void;
  shuffle: () => void;
  shuffleEnabled: boolean;
  start: () => Promise<void>;
}) {
  const pilot=usePilot();
  const [requested, setRequested] = useState<string | null>(null);
  const requestedStage = requested ? pilot.progress[requested]?.learningStage : null;
  const unavailable = props.scope === "due" && (recommendations.loading || Boolean(recommendations.error));
  return <div className="practice-ready-layout">
    <section className="listen-setup" aria-label="Listen and Repeat setup">
      <div className={`listen-selection-grid${props.scope === "custom" ? " has-order" : ""}`}>
        <div className="practice-topic-field"><TopicProgressPicker onChange={props.onTopic} progressPill topics={props.topics} value={props.topicId} /></div>
        <label><span className="simple-visually-hidden">Cards</span><select aria-label="Practice cards" className="practice-card-select" name="listen-count" onChange={(event) => {
          const [scope, count] = event.target.value.split(":") as [PracticeScope, PracticeCardCount];
          props.onSelection(scope, count);
        }} value={`${props.scope}:${props.scope === "due" && props.count === "all" ? "20" : props.count}`}>
          <option value="due:10">Recommended · Up to 10</option><option value="due:20">Recommended · Up to 20</option><option value="due:50">Recommended · Up to 50</option>
          <option value="custom:all">All Library</option><option value="custom:10">10 from Library</option><option value="custom:20">20 from Library</option><option value="custom:50">50 from Library</option>
        </select></label>
        {props.scope === "custom" ? <label><span className="simple-visually-hidden">Order</span><select aria-label="Card order" className="practice-order-select" name="listen-order"
          onChange={(event) => props.onOrder(event.target.value as PracticeOrder)} value={props.order}>
          <option value="original">{props.topicId ? "Original order" : "Oldest first"}</option><option value="newest">Newest first</option></select></label> : null}
      </div>
      {showPlaybackSettings ? <div className="listen-setup-playback">{playbackSettings}</div> : null}
      <div className="listen-start-options">
        <RepeatModeButton mode={repeatMode} onClick={cycleRepeat} size={17} />
        <ShuffleButton enabled={shuffleEnabled} onClick={shuffle} size={17} />
        <button aria-expanded={showPlaybackSettings} aria-label="Playback settings" className={showPlaybackSettings ? "is-active" : ""}
          onClick={() => setShowPlaybackSettings((shown) => !shown)} title="Playback settings" type="button"><Settings2 size={17} /></button>
        {!unavailable ? <span>{visibleComposition.due} started · {visibleComposition.new} new</span> : null}
      </div>
    </section>
    {props.scope === "due" ? <RecommendationStatus count={visibleCandidates.length} availability={recommendations.recommendation}
      loading={recommendations.loading} error={recommendations.error} mode="listen" /> : null}
    <button className="simple-primary listen-start" disabled={unavailable || !visibleCandidates.length} onClick={() => void start()} type="button">
      <Play fill="currentColor" size={15} />{unavailable ? "Play cards" : `Play ${visibleCandidates.length} ${visibleCandidates.length === 1 ? "card" : "cards"}`}
    </button>
    {pilot.syncError ? <p role="alert">{pilot.syncError} <button onClick={pilot.retry} type="button">Retry</button></p> : null}
    {requested && requestedStage && requestedStage !== "listen" ? <p role="status">{requestedStage === "tutor" ? "This card is ready for Tutor." : "Added to Active Recall."}</p> : null}
    {!unavailable ? <PracticeQueuePreview sets={props.topics} onToRecall={(item) => { setRequested(item.publicId); pilot.toRecall(item.publicId); }} emptyAction={props.emptyAction} items={visibleCandidates} language={props.language} mode="listen" onEdit={props.onEdit} onDelete={props.onDelete}
      onPlay={async (item) => {
        const prepared = await props.onPrepareAudio(item.target, props.playback, true);
        const url = URL.createObjectURL(prepared.blob);
        try { await props.onPlayPrepared(url, props.playback.repetitions, () => {
          const eventId = crypto.randomUUID();
          pilot.complete({ eventId, appearanceId: eventId, listenSessionId: eventId, cardId: item.publicId,
            language: props.language, completedAt: new Date().toISOString(), audioRepeatsInAppearance: props.playback.repetitions });
        }); } finally { URL.revokeObjectURL(url); }
      }} scope={props.scope} /> : null}
  </div>;
}
