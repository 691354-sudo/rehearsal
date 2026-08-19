import { useState } from "react";
import { ListenRepeat } from "./ListenRepeat";
import { RecallSession } from "./RecallSession";
import { usePracticeTopics } from "./usePracticeTopics";
import type { ReviewRating } from "../../lib/sessionQueue";
import type {
  AttemptDraft,
  DailyProgress,
  ElevenLabsConfig,
  Language,
  LearningItem,
  Mode,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";

export function PracticePage(props: {
  attempts: Record<string, AttemptDraft>;
  dueItemIds: string[];
  items: LearningItem[];
  language: Language;
  manualReviewItemId: string | null;
  mode: Mode;
  dailyProgress: DailyProgress;
  elevenLabs: ElevenLabsConfig;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onListened: (itemId: string) => Promise<void>;
  onManualReviewStarted: () => void;
  onMode: (mode: Mode) => void;
  onPausePlayback: () => void;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<PlaybackResult>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onRecallReview: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  onResumePlayback: () => void;
  onStopPlayback: () => void;
  playback: PlaybackPreferences;
  voices: string[];
}) {
  const [topicFilters, setTopicFilters] = useState<string[]>([]);
  const { selectedTopicItems, topics } = usePracticeTopics(props.language, topicFilters, setTopicFilters);
  const topicId = topicFilters[0] || "";
  const listeningAvailable = props.language === "en";

  return <main className="simple-main simple-main--practice">
    <header className="practice-header">
      <div><h1>Practice</h1><p>{props.dueItemIds.length} due · {props.dailyProgress.recall} recalled today{listeningAvailable ? ` · ${props.dailyProgress.shadow} listened today` : ""}</p></div>
      {listeningAvailable ? <div className="practice-modes" aria-label="Practice mode">
        <button aria-pressed={props.mode === "shadow"} onClick={() => props.onMode("shadow")} type="button">Listen &amp; Repeat</button>
        <button aria-pressed={props.mode === "recall"} onClick={() => props.onMode("recall")} type="button">Recall</button>
      </div> : null}
    </header>

    {props.mode === "recall" || !listeningAvailable ? <RecallSession
      attempts={props.attempts}
      dueItemIds={props.dueItemIds}
      items={props.items}
      language={props.language}
      listeningAvailable={listeningAvailable}
      manualReviewItemId={props.manualReviewItemId}
      onAnswer={props.onAnswer}
      onCheck={props.onCheck}
      onListenMode={() => props.onMode("shadow")}
      onManualReviewStarted={props.onManualReviewStarted}
      onRecallReview={props.onRecallReview}
      onTopic={(nextTopic) => setTopicFilters(nextTopic ? [nextTopic] : [])}
      selectedTopicItems={selectedTopicItems}
      topicId={topicId}
      topics={topics}
    /> : <ListenRepeat elevenLabs={props.elevenLabs} items={props.items} language={props.language}
      onListened={props.onListened} onPause={props.onPausePlayback} onPlay={props.onPlay}
      onPlayback={props.onPlayback} onResume={props.onResumePlayback} onStop={props.onStopPlayback}
      onPracticeEnabled={props.onPracticeEnabled}
      onTopic={(nextTopic) => setTopicFilters(nextTopic ? [nextTopic] : [])}
      playback={props.playback} selectedTopicItems={selectedTopicItems} topicId={topicId} topics={topics} voices={props.voices} />}
  </main>;
}
