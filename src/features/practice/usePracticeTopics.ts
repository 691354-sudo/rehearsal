import { useEffect, useRef, useState } from "react";
import { getTopic, getTopics } from "../library/topicRequests";
import type { IslandSummary, Language } from "../../shared/contracts";

export function usePracticeTopics(
  language: Language,
  topicId: string,
  onTopic: (topicId: string) => void,
) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItems, setTopicItems] = useState<string[]>([]);
  const [likedItems, setLikedItems] = useState<import("../../shared/contracts").LearningItem[]>([]);
  const [topicsLanguage, setTopicsLanguage] = useState<Language | null>(null);
  const onTopicRef = useRef(onTopic);
  onTopicRef.current = onTopic;

  useEffect(() => {
    const controller = new AbortController();
    setTopics([]);
    setTopicsLanguage(null);
    void getTopics(language, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setTopics(data);
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
    setLikedItems([]);
    if (!topicId) { setTopicItems([]); return; }
    const controller = new AbortController();
    setTopicItems([]);
    void getTopic(topicId, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setTopicItems(data.items.map((item) => item.publicId));
      if (topicId === "liked") setLikedItems(data.items);
    }).catch(() => {
      if (!controller.signal.aborted) setTopicItems([]);
    });
    return () => controller.abort();
  }, [topicId]);

  const selectedTopicItems = topicId ? topicItems : null;

  return { selectedTopicItems, topics, likedItems };
}
