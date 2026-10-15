import { ChevronDown } from "lucide-react";
import type { IslandSummary } from "../../shared/contracts";
import { TopicProgress } from "../progress/LearningProgress";
import { PracticePicker, type PracticeOption } from "./PracticePicker";

export function TopicProgressPicker({ onChange, progressPill = false, topics, value }: {
  onChange: (topicId: string) => void;
  progressPill?: boolean;
  topics: IslandSummary[];
  value: string;
}) {
  const selected = topics.find((topic) => topic.publicId === value);
  const options: PracticeOption[] = [{ value: "", label: "All cards", detail: <small>All topics and categories</small> },
    ...topics.map((topic, index) => ({ value: topic.publicId, label: topic.title, detail: <TopicProgress progress={topic.progress} />,
      group: topic.publicId.startsWith("category:") && !topics[index - 1]?.publicId.startsWith("category:") ? "Learning categories"
        : topic.publicId !== "liked" && !topic.publicId.startsWith("category:") && (!index || topics[index - 1]?.publicId === "liked" || topics[index - 1]?.publicId.startsWith("category:")) ? "Topics" : undefined }))];
  return <PracticePicker label="Practice set" options={options} onChange={onChange} value={value}
    triggerLabel={selected ? `Practice set: ${selected.title}, ${selected.progress.dueNow} due, ${selected.progress.new} not recalled yet` : value ? "Selected set unavailable" : "Practice set: All cards"}>
    <span className="topic-progress-trigger-copy"><strong>{selected?.title || (value ? "Selected set" : "All cards")}</strong>{selected && !progressPill ? <small>{selected.progress.dueNow} due · {selected.progress.new} not recalled yet</small> : null}</span>
    <span className="topic-progress-trigger-end">
      {selected && progressPill ? <small aria-hidden="true" className="topic-progress-trigger-count">{selected.progress.dueNow} · {selected.progress.new}</small> : null}
      <ChevronDown aria-hidden="true" size={15} />
    </span>
  </PracticePicker>;
}
