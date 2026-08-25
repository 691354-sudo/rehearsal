import { useCallback, useState } from "react";
import { AppLink } from "../../app/AppLink";
import { CardEditorDialog } from "../library/CardEditorDialog";
import { ListenRepeat } from "./ListenRepeat";
import { RecallSession } from "./RecallSession";
import { usePracticeTopics } from "./usePracticeTopics";
import type { ReviewRating } from "../../lib/sessionQueue";
import type { HistoryMode, PracticeRoute } from "../../lib/appRoute";
import { defaultLibraryRoute } from "../../lib/appRoute";
import type {
  AttemptDraft,
  DailyProgress,
  ElevenLabsConfig,
  Language,
  LearningItem,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import type { PreparedAudio } from "../audio/listenAudio";

export function PracticePage(props: {
  attempts: Record<string, AttemptDraft>;
  dueItemIds: string[];
  recommended: { due: number; new: number };
  items: LearningItem[];
  language: Language;
  route: PracticeRoute;
  dailyProgress: DailyProgress;
  elevenLabs: ElevenLabsConfig;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onListened: (itemId: string) => Promise<void>;
  onModeSelected: () => void;
  onItemUpdated: (item: LearningItem) => void;
  onRoute: (route: PracticeRoute, historyMode?: HistoryMode) => void;
  onPausePlayback: () => void;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<PlaybackResult>;
  onPlayPrepared: (url: string, repetitions: number) => Promise<number>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onPrepareAudio: (
    text: string,
    playback: Partial<PlaybackPreferences>,
    strictProvider: boolean,
  ) => Promise<PreparedAudio>;
  onRecallReview: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  onResumePlayback: () => void;
  onStopPlayback: () => void;
  playback: PlaybackPreferences;
  voices: string[];
}) {
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const onTopic = useCallback((topic: string) => props.onRoute({ ...props.route, topic, review: null }, "replace"), [props.onRoute, props.route]);
  const { selectedTopicItems, topics } = usePracticeTopics(props.language, props.route.topic, onTopic);
  const listeningAvailable = languageHasAudio(props.language);

  return <main className="simple-main simple-main--practice" data-onboarding-target="practice" id="main-content">
    <header className="practice-header"><h1>Practice</h1></header>
    <section className="practice-control-header" aria-label="Practice controls">
      {listeningAvailable ? <div className="practice-modes" aria-label="Practice mode">
        <AppLink aria-current={props.route.mode === "listen" ? "page" : undefined} className={props.route.mode === "listen" ? "is-active" : ""} onClick={props.onModeSelected}
          route={{ ...props.route, mode: "listen", scope: "library", review: null }}>Listen &amp; Repeat</AppLink>
        <AppLink aria-current={props.route.mode === "recall" ? "page" : undefined} className={props.route.mode === "recall" ? "is-active" : ""} onClick={props.onModeSelected}
          route={{ ...props.route, mode: "recall", review: null }}>Recall</AppLink>
      </div> : <strong>Recall</strong>}
      <p>{props.recommended.due} due · {props.recommended.new} not recalled yet · {props.dailyProgress.recall} recalled today{listeningAvailable ? ` · ${props.dailyProgress.shadow} listened today` : ""}</p>
    </section>

    {props.route.mode === "recall" || !listeningAvailable ? <RecallSession
      attempts={props.attempts}
      count={props.route.cards}
      dueItemIds={props.dueItemIds}
      emptyAction={<AppLink route={defaultLibraryRoute(props.language)}>Browse Library</AppLink>}
      elevenLabs={props.elevenLabs}
      items={props.items}
      language={props.language}
      listeningAvailable={listeningAvailable}
      manualReviewItemId={props.route.review}
      recommended={props.recommended}
      onAnswer={props.onAnswer}
      onCheck={props.onCheck}
      onEdit={setEditingItem}
      onSelection={(scope, cards) => props.onRoute({ ...props.route, cards, scope: scope === "custom" ? "library" : "due", review: null }, "replace")}
      onOrder={(order) => props.onRoute({ ...props.route, order }, "replace")}
      onListenMode={() => props.onRoute({ ...props.route, mode: "listen", scope: "library", review: null })}
      onListened={props.onListened}
      onManualReviewStarted={() => props.onRoute({ ...props.route, review: null }, "replace")}
      onRecallReview={props.onRecallReview}
      onPlay={props.onPlay}
      onPlayback={props.onPlayback}
      onTopic={onTopic}
      order={props.route.order}
      selectedTopicItems={selectedTopicItems}
      scope={props.route.scope === "library" ? "custom" : "due"}
      topicId={props.route.topic}
      topics={topics}
      playback={props.playback}
      voices={props.voices}
    /> : <ListenRepeat count={props.route.cards} dueItemIds={props.dueItemIds} editActive={Boolean(editingItem)} emptyAction={<AppLink route={defaultLibraryRoute(props.language)}>Browse Library</AppLink>}
      elevenLabs={props.elevenLabs} items={props.items} language={props.language}
      recommended={props.recommended}
      onEdit={setEditingItem} onListened={props.onListened} onPause={props.onPausePlayback} onPlay={props.onPlay}
      onPlayPrepared={props.onPlayPrepared} onPrepareAudio={props.onPrepareAudio}
      onSelection={(scope, cards) => props.onRoute({ ...props.route, cards, scope: scope === "custom" ? "library" : "due" }, "replace")}
      onOrder={(order) => props.onRoute({ ...props.route, order }, "replace")}
      onPlayback={props.onPlayback} onResume={props.onResumePlayback} onStop={props.onStopPlayback}
      onTopic={onTopic}
      playback={props.playback} selectedTopicItems={selectedTopicItems} order={props.route.order} scope={props.route.scope === "library" ? "custom" : "due"}
      topicId={props.route.topic} topics={topics} voices={props.voices} />}
    {editingItem ? <CardEditorDialog item={editingItem} language={props.language} onClose={() => setEditingItem(null)}
      onSaved={(item) => { props.onItemUpdated(item); setEditingItem(null); }} /> : null}
  </main>;
}
