import type { LearningItem } from "../shared/contracts";

export const buildListenQueue = (
  items: LearningItem[],
  topicItemIds: Set<string> | null,
  count: number | "all",
) => {
  const matching = items.filter((item) => !topicItemIds || topicItemIds.has(item.publicId));
  return count === "all" ? matching : matching.slice(0, count);
};
