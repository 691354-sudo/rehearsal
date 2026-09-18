import { useCallback, useState } from "react";
import { AppLink } from "../../app/AppLink";
import { CardEditorDialog } from "../library/CardEditorDialog";
import { ListenRepeat } from "./ListenRepeat";
import { practiceSetRoute, practiceSetValue } from "./practiceSet";
import { TopicProgressPicker } from "./TopicProgressPicker";
import { deleteCard } from "../library/deleteCard";
import { usePracticeTopics } from "./usePracticeTopics";
import type { HistoryMode, PracticeRoute } from "../../lib/appRoute";
import { defaultLibraryRoute } from "../../lib/appRoute";
import type {
  DailyProgress,
  ElevenLabsConfig,
  Language,
  LearningItem,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import type { PreparedAudio } from "../audio/listenAudio";
import { PilotRecall } from "../pilot/PilotRecall";

export function PracticePage(props: {
  recommended: { due: number; new: number };
  items: LearningItem[];
  language: Language;
  route: PracticeRoute;
  dailyProgress: DailyProgress;
  elevenLabs: ElevenLabsConfig;
  onPilotUpdated: () => void;
  onItemUpdated: (item: LearningItem) => void;
  onItemDeleted: (id: string) => void;
  onRoute: (route: PracticeRoute, historyMode?: HistoryMode) => void;
  onPausePlayback: () => void;
  onPlay: (text: string, playback: PlaybackPreferences) => Promise<PlaybackResult>;
  onPlayPrepared: (url: string, repetitions: number, onFirstCompleted?: () => void) => Promise<number>;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPrepareAudio: (
    text: string,
    playback: Partial<PlaybackPreferences>,
    strictProvider: boolean,
  ) => Promise<PreparedAudio>;
  onResumePlayback: () => void;
  onStopPlayback: () => void;
  playback: PlaybackPreferences;
  voices: string[];
}) {
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const [revision, setRevision] = useState(0);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const value = practiceSetValue(props.route);
  const onTopic = useCallback((next: string) => props.onRoute({ ...props.route, ...practiceSetRoute(next), review: null }, "replace"), [props.onRoute, props.route]);
  const { selectedTopicItems, topics, collectionItems, error, retry } = usePracticeTopics(props.language, value, onTopic, revision);
  const deleted = (id: string) => {
    props.onStopPlayback(); props.onItemDeleted(id); props.onPilotUpdated();
    setDeletedIds((before) => [...before, id]); setRevision((before) => before + 1); setEditingItem(null);
  };
  const remove = async (item: LearningItem) => {
    setDeleteError("");
    try { if (await deleteCard(item.publicId)) deleted(item.publicId); }
    catch (caught) { setDeleteError((caught as Error).message); }
  };
  const organizationError = props.route.homework ? "" : error;
  const listeningAvailable = languageHasAudio(props.language);

  return <main className="simple-main simple-main--practice" data-onboarding-target="practice" id="main-content">
    <header className="practice-header"><h1>Practice</h1></header>
    <section className="practice-control-header" aria-label="Practice controls">
      {listeningAvailable ? <div className="practice-modes" aria-label="Practice mode">
        <AppLink aria-current={props.route.mode === "listen" ? "page" : undefined} className={props.route.mode === "listen" ? "is-active" : ""}
          route={{ ...props.route, mode: "listen", scope: "due", review: null }}>Listen &amp; Repeat</AppLink>
        <AppLink aria-current={props.route.mode === "recall" ? "page" : undefined} className={props.route.mode === "recall" ? "is-active" : ""}
          route={{ ...props.route, mode: "recall", review: null }}>Recall</AppLink>
      </div> : <strong>Recall</strong>}
      <p>{props.recommended.due} due · {props.recommended.new} not recalled yet · {props.dailyProgress.recall} recalled today{listeningAvailable ? ` · ${props.dailyProgress.shadow} listened today` : ""}</p>
    </section>

    {deleteError ? <p className="category-error" role="alert">{deleteError}</p> : null}
    {organizationError ? <section><TopicProgressPicker topics={topics} value={value} onChange={onTopic} />
      <p className="category-error" role="alert">{organizationError} <button type="button" onClick={retry}>Retry</button></p></section> : null}
    {organizationError ? null : props.route.mode === "recall" || !listeningAvailable ? <PilotRecall key={props.route.homework ?? `standalone:${props.route.review || value}`} props={props} topics={topics} onTopic={onTopic} onEdit={setEditingItem} onDelete={(item) => void remove(item)} deletedIds={deletedIds} revision={revision} />
 : <ListenRepeat key={value} count={props.route.cards} editActive={Boolean(editingItem)} emptyAction={<AppLink route={defaultLibraryRoute(props.language)}>Browse Library</AppLink>}
      elevenLabs={props.elevenLabs} items={value ? collectionItems : props.items} language={props.language}
      onEdit={setEditingItem} onDelete={(item) => void remove(item)} deletedIds={deletedIds} onPause={props.onPausePlayback}
      onPlayPrepared={props.onPlayPrepared} onPrepareAudio={props.onPrepareAudio}
      onSelection={(scope, cards) => props.onRoute({ ...props.route, cards, scope: scope === "custom" ? "library" : "due" }, "replace")}
      onOrder={(order) => props.onRoute({ ...props.route, order }, "replace")}
      onPlayback={props.onPlayback} onResume={props.onResumePlayback} onStop={props.onStopPlayback}
      onTopic={onTopic}
      playback={props.playback} selectedTopicItems={props.route.scope === "due" ? null : selectedTopicItems} order={props.route.order} scope={props.route.scope === "library" ? "custom" : "due"}
      topicId={value} topics={topics} voices={props.voices} />}
    {editingItem ? <CardEditorDialog item={editingItem} language={props.language} onClose={() => setEditingItem(null)}
      onDeleted={deleted} onSaved={(item) => { props.onItemUpdated(item); setRevision((before) => before + 1); setEditingItem(null); }} /> : null}
  </main>;
}
