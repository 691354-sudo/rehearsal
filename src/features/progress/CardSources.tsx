import type { IslandSummary, LearningItem } from "../../shared/contracts";

export function CardSources({ item, sets }: {
  item: LearningItem;
  sets: Pick<IslandSummary, "publicId" | "title">[];
}) {
  const categoryIds = new Set((item.learningCategoryIds ?? []).map((id) => `category:${id}`));
  const categories = sets.filter((set) => categoryIds.has(set.publicId));
  const topic = sets.find((set) => set.publicId === item.topicId);
  const sources = categories.length ? categories : topic ? [topic] : [];
  if (!sources.length) return null;

  return <span className="practice-source-tags" aria-label={categories.length ? "Categories" : "Topic"}>
    {sources.map((source) => <span className="practice-source-tag" key={source.publicId}>{source.title}</span>)}
  </span>;
}
