import type { LearningItem } from "../../shared/contracts";
import type { PracticeOrder } from "../../lib/appRoute";

export type PracticeScope = "due" | "custom";

// Recommendations are selected on the server; manual Library browsing keeps its chosen order.
export const buildLibrarySelection = (
  items: LearningItem[], topicItemIds: readonly string[] | null, count: number | "all", order: PracticeOrder,
) => {
  const byId = new Map(items.map((item) => [item.publicId, item]));
  const topicIds = topicItemIds ? new Set(topicItemIds) : null;
  const source = order === "original" && topicItemIds
    ? topicItemIds.flatMap((id) => byId.get(id) || [])
    : [...byId.values()].sort((left, right) => {
      const direction = order === "original" ? 1 : -1;
      const difference = (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0);
      return direction * (difference || (left.id || 0) - (right.id || 0));
    });
  const matching = source.filter((item) => !topicIds || topicIds.has(item.publicId));
  return count === "all" ? matching : matching.slice(0, count);
};
