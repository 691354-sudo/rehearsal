import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language } from "../../shared/contracts";

export function usePracticeTopics(
  language: Language,
  topicId: string,
  onTopic: (topicId: string) => void,
) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItems, setTopicItems] = useState<string[]>([]);
  const [topicsLanguage, setTopicsLanguage] = useState<Language | null>(null);
  const onTopicRef = useRef(onTopic);
  onTopicRef.current = onTopic;

  useEffect(() => {
    const controller = new AbortController();
    setTopics([]);
    setTopicsLanguage(null);
    void apiFetch(`/api/islands?language=${language}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Topics unavailable");
      const data = await response.json() as { islands: IslandSummary[] };
      setTopics(data.islands || []);
      setTopicsLanguage(language);
    }).catch(() => {
      if (!controller.signal.aborted) setTopics([]);
    });
    return () => controller.abort();
  }, [language]);

  useEffect(() => {
    if (!topicId || topicsLanguage !== language) return;
    if (!topics.some((topic) => topic.publicId === topicId)) onTopicRef.current("");
  }, [language, topicId, topics, topicsLanguage]);

  useEffect(() => {
    if (!topicId) { setTopicItems([]); return; }
    const controller = new AbortController();
    setTopicItems([]);
    void apiFetch(`/api/islands/${encodeURIComponent(topicId)}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Topic unavailable");
      const data = await response.json() as { island: Island };
      setTopicItems(data.island.items.map((item) => item.publicId));
    }).catch(() => {
      if (!controller.signal.aborted) setTopicItems([]);
    });
    return () => controller.abort();
  }, [topicId]);

  const selectedTopicItems = topicId ? topicItems : null;

  return { selectedTopicItems, topics };
}
