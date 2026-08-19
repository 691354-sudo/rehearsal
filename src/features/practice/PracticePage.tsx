import { useMemo, useState } from "react";
import { DrillBar } from "./DrillBar";
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
} from "../../shared/contracts";

export function PracticePage(props: {
  attempts: Record<string, AttemptDraft>;
  dueItemIds: string[];
  items: LearningItem[];
  language: Language;
  mode: Mode;
  dailyProgress: DailyProgress;
  elevenLabs: ElevenLabsConfig;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onMode: (mode: Mode) => void;
  onRecallReview: (itemId: string, rating: ReviewRating) => Promise<boolean>;
  onStopPlayback: () => void;
  playback: PlaybackPreferences;
  openaiConfigured: boolean;
}) {
  const [topicFilters, setTopicFilters] = useState<string[]>([]);
  const { selectedTopicItems, topics } = usePracticeTopics(props.language, topicFilters, setTopicFilters);
  const listeningItems = useMemo(() => props.items.filter((item) => item.practiceEnabled !== false), [props.items]);
  const topicId = topicFilters[0] || "";

  return <main className="simple-main simple-main--practice">
    <header className="practice-header">
      <div><h1>Practice</h1><p>{props.dueItemIds.length} due · {props.dailyProgress.recall} recalled today · {props.dailyProgress.shadow} listened today</p></div>
      <div className="practice-modes" aria-label="Practice mode">
        <button aria-pressed={props.mode === "shadow"} onClick={() => props.onMode("shadow")} type="button">Listen &amp; Repeat</button>
        <button aria-pressed={props.mode === "recall"} onClick={() => props.onMode("recall")} type="button">Recall</button>
      </div>
    </header>

    {props.mode === "recall" ? <RecallSession
      attempts={props.attempts}
      dueItemIds={props.dueItemIds}
      items={props.items}
      language={props.language}
      onAnswer={props.onAnswer}
      onCheck={props.onCheck}
      onListenMode={() => props.onMode("shadow")}
      onRecallReview={props.onRecallReview}
      onTopic={(nextTopic) => setTopicFilters(nextTopic ? [nextTopic] : [])}
      selectedTopicItems={selectedTopicItems}
      topicId={topicId}
      topics={topics}
    /> : <section className="listen-legacy" aria-label="Listen and Repeat">
      <DrillBar arranging={false} elevenLabsConfigured={props.elevenLabs.configured}
        elevenLabsVoiceId={props.elevenLabs.voice.id} items={listeningItems} language={props.language}
        loopIds={[]} onArrange={() => undefined} onBeforeStart={props.onStopPlayback}
        onSettings={() => undefined} onState={() => undefined} openaiConfigured={props.openaiConfigured}
        playback={props.playback} />
    </section>}
  </main>;
}
