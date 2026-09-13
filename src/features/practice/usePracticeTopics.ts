import { useEffect, useRef, useState } from "react";
import { getTopic, getTopics } from "../library/topicRequests";
import { getCategories, getCategory } from "../library/categoryRequests";
import type { IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { apiFetch } from "../../shared/api";
import { practiceSet } from "./practiceSet";

export function usePracticeTopics(language: Language, value: string, onTopic: (value: string) => void, revision = 0) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [collectionItems, setCollectionItems] = useState<LearningItem[]>([]);
  const [recommendation, setRecommendation] = useState<{ ids: string[]; composition: { due: number; new: number } } | null>(null);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const onTopicRef = useRef(onTopic); onTopicRef.current = onTopic;
  useEffect(() => {
    const controller = new AbortController(); setError(""); setLoading(true); setCollectionItems([]); setRecommendation(null);
    void (async () => {
      const [contexts, catalog] = await Promise.all([getTopics(language, controller.signal), getCategories(language, controller.signal)]);
      if (controller.signal.aborted) return;
      setTopics([...contexts.filter((topic) => topic.publicId === "liked"),
        ...catalog.categories.map((category) => ({ ...category, publicId: `category:${category.publicId}` })),
        ...contexts.filter((topic) => topic.publicId !== "liked")]);
      const set = practiceSet(value);
      if (set.kind === "topic" && catalog.redirects[set.id]) { onTopicRef.current(`category:${catalog.redirects[set.id]}`); return; }
      if (set.kind !== "all") {
        const collection = set.kind === "category" ? await getCategory(set.id, controller.signal)
          : await getTopic(set.kind === "liked" ? "liked" : set.id, controller.signal);
        const params = new URLSearchParams({ language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        params.set(set.kind === "category" ? "categoryId" : "topicId", set.kind === "liked" ? "liked" : set.id);
        const response = await apiFetch(`/api/practice/due?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load recommendations.");
        const due = await response.json() as { items: LearningItem[]; composition: { due: number; new: number } };
        if (!controller.signal.aborted) { setCollectionItems(collection.items); setRecommendation({ ids: due.items.map((item) => item.publicId), composition: due.composition }); }
      }
    })().catch(() => { if (!controller.signal.aborted) setError("Your selected set could not be loaded. Retry to continue."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [language, value, revision, retryCount]);
  return { topics, collectionItems, selectedTopicItems: value ? collectionItems.map((item) => item.publicId) : null,
    error, loading, recommendation, retry: () => setRetryCount((current) => current + 1) };
}
