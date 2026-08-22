import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateAttempt } from "../../lib/compare";
import type { ReviewRating } from "../../lib/sessionQueue";
import { apiFetch } from "../../shared/api";
import type {
  AttemptDraft,
  DailyProgress,
  Evaluation,
  Language,
  LearningItem,
} from "../../shared/contracts";
import { normalizeNfc } from "../../../contracts/text";

type LearningSnapshot = {
  items: LearningItem[];
  dueItemIds: string[];
  recommended: { due: number; new: number };
  dailyProgress: DailyProgress;
};

const emptySnapshot = (): LearningSnapshot => ({
  items: [],
  dueItemIds: [],
  recommended: { due: 0, new: 0 },
  dailyProgress: { recall: 0, shadow: 0, pattern: 0 },
});

const removeRecommendedCount = (snapshot: LearningSnapshot, itemId: string, stage: LearningItem["progress"]["stage"]) => {
  if (!snapshot.dueItemIds.includes(itemId)) return snapshot.recommended;
  return stage === "new"
    ? { ...snapshot.recommended, new: Math.max(0, snapshot.recommended.new - 1) }
    : { ...snapshot.recommended, due: Math.max(0, snapshot.recommended.due - 1) };
};

export const useLearningData = (language: Language) => {
  const [attempts, setAttempts] = useState<Record<string, AttemptDraft>>({});
  const [snapshots, setSnapshots] = useState<Partial<Record<Language, LearningSnapshot>>>({});
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const activeLanguageRef = useRef(language);
  activeLanguageRef.current = language;
  const { items, dueItemIds, recommended, dailyProgress } = snapshots[language] || emptySnapshot();

  const updateSnapshot = useCallback((targetLanguage: Language, update: (snapshot: LearningSnapshot) => LearningSnapshot) => {
    setSnapshots((current) => ({
      ...current,
      [targetLanguage]: update(current[targetLanguage] || emptySnapshot()),
    }));
  }, []);
  const setAvailabilityFor = useCallback((targetLanguage: Language, online: boolean) => {
    if (activeLanguageRef.current === targetLanguage) setApiOnline(online);
  }, []);

  const loadItems = useCallback(async (nextLanguage: Language, signal?: AbortSignal) => {
    try {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const [libraryResponse, dueResponse, progressResponse] = await Promise.all([
        apiFetch(`/api/items?language=${nextLanguage}&limit=2000&includeSchedule=true`, { signal }),
        apiFetch(`/api/practice/due?language=${nextLanguage}&limit=2000`, { signal }),
        apiFetch(`/api/practice/progress?language=${nextLanguage}&since=${encodeURIComponent(startOfDay.toISOString())}`, { signal }),
      ]);
      if (!libraryResponse.ok || !dueResponse.ok || !progressResponse.ok) throw new Error("API unavailable");
      const library = await libraryResponse.json() as { items: LearningItem[] };
      const due = await dueResponse.json() as { items: LearningItem[]; composition: { due: number; new: number } };
      const progress = await progressResponse.json() as DailyProgress & { completed: number };
      const dueById = new Map(due.items.map((item) => [item.publicId, item]));
      updateSnapshot(nextLanguage, () => ({
        items: library.items.map((item) => dueById.get(item.publicId) || item),
        dueItemIds: due.items.map((item) => item.publicId),
        recommended: due.composition,
        dailyProgress: {
          recall: progress.recall ?? progress.completed,
          shadow: progress.shadow ?? 0,
          pattern: progress.pattern ?? 0,
        },
      }));
      setAvailabilityFor(nextLanguage, true);
      return true;
    } catch {
      if (signal?.aborted) return false;
      setAvailabilityFor(nextLanguage, false);
      return false;
    }
  }, [setAvailabilityFor, updateSnapshot]);

  useEffect(() => {
    setAttempts({});
    const controller = new AbortController();
    void loadItems(language, controller.signal);
    return () => controller.abort();
  }, [language, loadItems]);

  const setAnswer = (itemId: string, answer: string) => {
    setAttempts((current) => ({ ...current, [itemId]: { answer } }));
  };

  const checkAnswer = (itemId: string) => {
    const practiceItem = items.find((candidate) => candidate.publicId === itemId);
    const answer = normalizeNfc(attempts[itemId]?.answer.trim() || "");
    if (!practiceItem || !answer) return;
    const local = evaluateAttempt({
      id: practiceItem.publicId,
      language: practiceItem.language,
      cue: practiceItem.cue,
      target: practiceItem.target,
      acceptedAnswers: practiceItem.acceptedAnswers,
      note: practiceItem.note,
      source: practiceItem.source,
      status: practiceItem.status,
    }, answer);
    const evaluation: Evaluation = {
      score: local.accuracy,
      verdict: local.verdict,
      naturalAnswer: local.expected,
      correctedAnswer: local.expected,
      summaryRu: local.verdict === "exact" ? "Точно." : "Сравни свой вариант с естественной фразой.",
      mistakes: [],
      expectedTokens: local.expectedTokens,
      answerTokens: local.answerTokens,
    };
    setAttempts((current) => ({ ...current, [itemId]: { answer, evaluation } }));
  };

  const commitRecall = async (itemId: string, rating: ReviewRating) => {
    const reviewedItem = items.find((candidate) => candidate.publicId === itemId);
    const attempt = attempts[itemId];
    if (!reviewedItem || !attempt?.evaluation) return false;
    try {
      const response = await apiFetch("/api/attempts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: reviewedItem.publicId, answer: attempt.answer, mode: "recall", rating }),
      });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { attempt: { schedule?: LearningItem["schedule"] } };
      setAvailabilityFor(language, true);
      updateSnapshot(language, (current) => ({
        ...current,
        dueItemIds: current.dueItemIds.filter((publicId) => publicId !== itemId),
        recommended: removeRecommendedCount(current, itemId, reviewedItem.progress.stage),
        items: current.items.map((candidate) => candidate.publicId === itemId
          ? {
              ...candidate,
              schedule: data.attempt.schedule || candidate.schedule,
              progress: {
                ...candidate.progress,
                recalls: candidate.progress.recalls + 1,
                stage: data.attempt.schedule?.state === "learning" || data.attempt.schedule?.state === "relearning"
                  ? "learning" : "strong",
              },
            } : candidate),
        dailyProgress: { ...current.dailyProgress, recall: current.dailyProgress.recall + 1 },
      }));
      setAttempts((current) => {
        const next = { ...current }; delete next[itemId]; return next;
      });
      return true;
    } catch {
      setAvailabilityFor(language, false);
      return false;
    }
  };

  const commitListening = async (itemId: string) => {
    try {
      const response = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, mode: "listen", rating: "good" }),
      });
      if (!response.ok) throw new Error("Listening activity failed");
      setAvailabilityFor(language, true);
      updateSnapshot(language, (current) => ({
        ...current,
        items: current.items.map((item) => item.publicId === itemId
          ? { ...item, progress: { ...item.progress, listens: item.progress.listens + 1 } } : item),
        dailyProgress: { ...current.dailyProgress, shadow: current.dailyProgress.shadow + 1 },
      }));
    } catch { setAvailabilityFor(language, false); }
  };

  const updatePracticeEnabled = async (itemId: string, practiceEnabled: boolean) => {
    try {
      const response = await apiFetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceEnabled }),
      });
      if (!response.ok) throw new Error("Card update failed");
      updateSnapshot(language, (current) => ({
        ...current,
        recommended: !practiceEnabled
          ? removeRecommendedCount(current, itemId,
            current.items.find((item) => item.publicId === itemId)?.progress.stage || "new")
          : current.recommended,
        items: current.items.map((item) => item.publicId === itemId ? {
          ...item,
          practiceEnabled,
          progress: { ...item.progress, stage: practiceEnabled ? item.progress.stage === "learned" ? "new" : item.progress.stage : "learned" },
        } : item),
        dueItemIds: practiceEnabled
          ? current.dueItemIds
          : current.dueItemIds.filter((dueId) => dueId !== itemId),
      }));
      if (practiceEnabled) void loadItems(language);
      setAvailabilityFor(language, true);
      return true;
    } catch { setAvailabilityFor(language, false); return false; }
  };

  const updateItem = (item: LearningItem) => updateSnapshot(language, (current) => ({
    ...current,
    items: current.items.map((candidate) => candidate.publicId === item.publicId
      ? { ...candidate, ...item, progress: candidate.progress, schedule: candidate.schedule } : candidate),
  }));

  const removeItem = (itemId: string) => {
    updateSnapshot(language, (current) => ({
      ...current,
      recommended: removeRecommendedCount(current, itemId,
        current.items.find((item) => item.publicId === itemId)?.progress.stage || "new"),
      items: current.items.filter((item) => item.publicId !== itemId),
      dueItemIds: current.dueItemIds.filter((dueId) => dueId !== itemId),
    }));
    setAttempts((current) => {
      const next = { ...current }; delete next[itemId]; return next;
    });
  };

  return {
    apiOnline,
    attempts,
    checkAnswer,
    commitListening,
    commitRecall,
    dailyProgress,
    dueItemIds,
    items,
    loadItems,
    recommended,
    removeItem,
    resetAttempts: () => setAttempts({}),
    setAnswer,
    setApiOnline,
    updateItem,
    updatePracticeEnabled,
  };
};
