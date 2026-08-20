import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language } from "../../shared/contracts";

export function usePracticeTopics(
  language: Language,
  topicId: string,
  onTopic: (topicId: string) => void,
) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItems, setTopicItems] = useState<string[]>([]);

  useEffect(() => {
    void apiFetch(`/api/islands?language=${language}`).then(async (response) => {
      if (!response.ok) throw new Error("Topics unavailable");
      const data = await response.json() as { islands: IslandSummary[] };
      setTopics(data.islands || []);
      const validIds = new Set(data.islands.map((topic) => topic.publicId));
      if (topicId && !validIds.has(topicId)) onTopic("");
    }).catch(() => { setTopics([]); if (topicId) onTopic(""); });
  }, [language, onTopic, topicId]);

  useEffect(() => {
    if (!topicId) { setTopicItems([]); return; }
    void apiFetch(`/api/islands/${encodeURIComponent(topicId)}`).then(async (response) => {
      if (!response.ok) throw new Error("Topic unavailable");
      const data = await response.json() as { island: Island };
      setTopicItems(data.island.items.map((item) => item.publicId));
    }).catch(() => setTopicItems([]));
  }, [topicId]);

  const selectedTopicItems = useMemo(() => topicId ? new Set(topicItems) : null, [topicId, topicItems]);

  return { selectedTopicItems, topics };
}
