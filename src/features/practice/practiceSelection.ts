import type { LearningItem } from "../../shared/contracts";

export type PracticeScope = "due" | "custom";

export const buildPracticeSelection = (
  items: LearningItem[],
  dueItemIds: string[],
  topicItemIds: Set<string> | null,
  count: number | "all",
  scope: PracticeScope,
) => {
  const byId = new Map(items.map((item) => [item.publicId, item]));
  const source = scope === "due"
    ? dueItemIds.flatMap((itemId) => byId.get(itemId) || [])
    : items;
  const matching = source.filter((item) => !topicItemIds || topicItemIds.has(item.publicId));
  return count === "all" ? matching : matching.slice(0, count);
};
