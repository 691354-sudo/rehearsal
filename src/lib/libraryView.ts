import type { LearningItem } from "../shared/contracts";

export type LibraryStatus = "all" | "new" | "learning" | "learned";
export type LibrarySort = "recent" | "oldest" | "due" | "az";

export const libraryStatusOf = (item: LearningItem): Exclude<LibraryStatus, "all"> =>
  !item.practiceEnabled ? "learned" : item.schedule ? "learning" : "new";

const timeOf = (value?: string, fallback = 0) => value ? new Date(value).getTime() : fallback;

export const filterLibraryItems = (items: LearningItem[], options: {
  query: string;
  status: LibraryStatus;
  sort: LibrarySort;
  topicItemIds: Set<string> | null;
}) => {
  const query = options.query.trim().toLocaleLowerCase();
  const filtered = items.filter((item) =>
    (!query || [item.target, item.cue, item.note].some((value) => value.toLocaleLowerCase().includes(query)))
    && (options.status === "all" || libraryStatusOf(item) === options.status)
    && (!options.topicItemIds || options.topicItemIds.has(item.publicId)));
  return filtered.sort((left, right) => {
    if (options.sort === "oldest") return timeOf(left.createdAt) - timeOf(right.createdAt);
    if (options.sort === "due") return timeOf(left.schedule?.dueAt, Number.POSITIVE_INFINITY)
      - timeOf(right.schedule?.dueAt, Number.POSITIVE_INFINITY);
    if (options.sort === "az") return left.target.localeCompare(right.target);
    return timeOf(right.createdAt) - timeOf(left.createdAt);
  });
};
