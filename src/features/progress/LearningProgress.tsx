import { Headphones, RotateCcw } from "lucide-react";
import type { IslandSummary, LearningItem } from "../../shared/contracts";

export const learningStageLabel: Record<LearningItem["progress"]["stage"], string> = {
  new: "New",
  learning: "Learning",
  due: "Due",
  strong: "Strong",
  learned: "Learned",
};

export function LearningStageBadge({ stage }: { stage: LearningItem["progress"]["stage"] }) {
  return <strong className="learning-stage" data-stage={stage}>{learningStageLabel[stage]}</strong>;
}

export function LearningProgressCounts({ progress }: { progress: LearningItem["progress"] }) {
  return <span className="learning-counts">
    <span aria-label={`${progress.recalls} recalls`}><RotateCcw aria-hidden="true" size={12} />{progress.recalls}</span>
    <span aria-label={`${progress.listens} listens`}><Headphones aria-hidden="true" size={12} />{progress.listens}</span>
  </span>;
}

export function LearningProgressBadge({ progress }: { progress: LearningItem["progress"] }) {
  return <span className="learning-progress"><LearningStageBadge stage={progress.stage} /><LearningProgressCounts progress={progress} /></span>;
}

const stages = ["new", "learning", "due", "strong", "learned"] as const;

export function TopicProgress({ progress }: { progress: IslandSummary["progress"] }) {
  const total = stages.reduce((sum, stage) => sum + progress[stage], 0);
  return <div className="topic-progress">
    <span aria-label={stages.map((stage) => `${learningStageLabel[stage]} ${progress[stage]}`).join(", ")}
      className="topic-progress-bar" role="img">
      {total ? stages.map((stage) => progress[stage] ? <i data-stage={stage} key={stage}
        style={{ width: `${progress[stage] / total * 100}%` }} /> : null) : <i data-stage="empty" />}
    </span>
    <small>{progress.dueNow} due · {progress.new} not recalled yet</small>
  </div>;
}
