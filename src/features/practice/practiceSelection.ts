import type { LearningItem } from "../../shared/contracts";
import type { PracticeOrder } from "../../lib/appRoute";

export type PracticeScope = "due" | "custom";

export const buildPracticeSelection = (
  items: LearningItem[],
  dueItemIds: string[],
  topicItemIds: readonly string[] | null,
  count: number | "all",
  scope: PracticeScope,
  order: PracticeOrder,
) => {
  const byId = new Map(items.map((item) => [item.publicId, item]));
  const topicIds = topicItemIds ? new Set(topicItemIds) : null;
  const source = scope === "due" ? dueItemIds.flatMap((itemId) => byId.get(itemId) || [])
    : order === "original" && topicItemIds
      ? topicItemIds.flatMap((itemId) => byId.get(itemId) || [])
      : [...items].sort((left, right) => {
        const direction = order === "original" ? 1 : -1;
        const createdDifference = (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0);
        return direction * (createdDifference || (left.id || 0) - (right.id || 0));
      });
  const matching = source.filter((item) => !topicIds || topicIds.has(item.publicId));
  return count === "all" ? matching : matching.slice(0, count);
};
