import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language } from "../../shared/contracts";

export function usePracticeTopics(
  language: Language,
  topicFilters: string[],
  setTopicFilters: Dispatch<SetStateAction<string[]>>,
) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItems, setTopicItems] = useState<Record<string, string[]>>({});

  useEffect(() => {
    void apiFetch(`/api/islands?language=${language}`).then(async (response) => {
      if (!response.ok) throw new Error("Topics unavailable");
      const data = await response.json() as { islands: IslandSummary[] };
      setTopics(data.islands || []);
      const validIds = new Set(data.islands.map((topic) => topic.publicId));
      setTopicFilters((current) => current.filter((topicId) => validIds.has(topicId)));
    }).catch(() => { setTopics([]); setTopicFilters([]); });
  }, [language, setTopicFilters]);

  useEffect(() => {
    if (!topicFilters.length) { setTopicItems({}); return; }
    void Promise.all(topicFilters.map(async (topicId) => {
      const response = await apiFetch(`/api/islands/${encodeURIComponent(topicId)}`);
      if (!response.ok) throw new Error("Topic unavailable");
      const data = await response.json() as { island: Island };
      return [topicId, data.island.items.map((item) => item.publicId)] as const;
    })).then((entries) => setTopicItems(Object.fromEntries(entries))).catch(() => setTopicItems({}));
  }, [topicFilters]);

  const selectedTopicItems = useMemo(() => topicFilters.length
    ? new Set(topicFilters.flatMap((topicId) => topicItems[topicId] || []))
    : null, [topicFilters, topicItems]);
  const topicTitleByItem = useMemo(() => {
    const result = new Map<string, string>();
    for (const topic of topics) {
      for (const itemId of topicItems[topic.publicId] || []) {
        if (!result.has(itemId)) result.set(itemId, topic.title);
      }
    }
    return result;
  }, [topicItems, topics]);

  return { selectedTopicItems, topicTitleByItem, topics };
}
