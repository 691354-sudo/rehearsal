import type { LearningItem } from "../../shared/contracts";
import type { PracticeOrder } from "../../lib/appRoute";

export type PracticeScope = "due" | "custom";

const preferenceRank: Record<LearningItem["preference"], number> = {
  like: 0,
  neutral: 1,
  dislike: 2,
};

const compareRecommendedNew = (left: LearningItem, right: LearningItem) =>
  right.progress.listens - left.progress.listens
  || preferenceRank[left.preference] - preferenceRank[right.preference]
  || right.commonness - left.commonness
  || right.personaFit - left.personaFit
  || (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0)
  || (left.id || 0) - (right.id || 0);

export const buildPracticeSelection = (
  items: LearningItem[],
  dueItemIds: string[],
  topicItemIds: readonly string[] | null,
  count: number | "all",
  scope: PracticeScope,
  order: PracticeOrder,
  newItemLimit = 10,
) => {
  const byId = new Map(items.map((item) => [item.publicId, item]));
  const topicIds = topicItemIds ? new Set(topicItemIds) : null;
  const source = scope === "due" ? topicIds
    ? [
        ...dueItemIds.flatMap((itemId) => {
          const item = byId.get(itemId);
          return item && item.progress.stage !== "new" && topicIds.has(itemId) ? [item] : [];
        }),
        ...items.filter((item) => item.practiceEnabled && item.progress.stage === "new" && topicIds.has(item.publicId))
          .sort(compareRecommendedNew)
          .slice(0, newItemLimit),
      ]
    : dueItemIds.flatMap((itemId) => byId.get(itemId) || [])
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
