import type { LearningItem } from "../shared/contracts";
import type { Language } from "../shared/contracts";
import { languageCopy } from "../shared/config";
import { normalizeNfc } from "../../contracts/text";

export type LibraryStatus = "all" | "new" | "learning" | "due" | "strong" | "learned";
export type LibrarySort = "recent" | "oldest" | "due" | "least" | "az";

export const libraryStatusOf = (item: LearningItem): Exclude<LibraryStatus, "all"> =>
  item.progress.stage;

const timeOf = (value?: string, fallback = 0) => value ? new Date(value).getTime() : fallback;

export const filterLibraryItems = (items: LearningItem[], options: {
  query: string;
  status: LibraryStatus;
  sort: LibrarySort;
  topicItemIds: Set<string> | null;
  language?: Language;
}) => {
  const query = normalizeNfc(options.query.trim()).toLocaleLowerCase();
  const filtered = items.filter((item) =>
    (!query || [item.target, item.cue, item.note].some((value) => value.toLocaleLowerCase().includes(query)))
    && (options.status === "all" || libraryStatusOf(item) === options.status)
    && (!options.topicItemIds || options.topicItemIds.has(item.publicId)));
  return filtered.sort((left, right) => {
    if (options.sort === "oldest") return timeOf(left.createdAt) - timeOf(right.createdAt);
    if (options.sort === "due") return timeOf(left.schedule?.dueAt, Number.POSITIVE_INFINITY)
      - timeOf(right.schedule?.dueAt, Number.POSITIVE_INFINITY);
    if (options.sort === "least") return left.progress.recalls - right.progress.recalls
      || left.progress.listens - right.progress.listens
      || timeOf(left.createdAt) - timeOf(right.createdAt);
    if (options.sort === "az") return new Intl.Collator(
      languageCopy[options.language || left.language].locale,
    ).compare(left.target, right.target);
    return timeOf(right.createdAt) - timeOf(left.createdAt);
  });
};
