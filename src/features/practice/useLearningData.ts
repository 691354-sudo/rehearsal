import { useCallback, useEffect, useState } from "react";
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

export const useLearningData = (language: Language) => {
  const [attempts, setAttempts] = useState<Record<string, AttemptDraft>>({});
  const [items, setItems] = useState<LearningItem[]>([]);
  const [dueItemIds, setDueItemIds] = useState<string[]>([]);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>({ recall: 0, shadow: 0, pattern: 0 });
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const loadItems = useCallback(async (nextLanguage: Language) => {
    try {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const [libraryResponse, dueResponse, progressResponse] = await Promise.all([
        apiFetch(`/api/items?language=${nextLanguage}&limit=500&includeSchedule=true`),
        apiFetch(`/api/practice/due?language=${nextLanguage}&limit=100`),
        apiFetch(`/api/practice/progress?language=${nextLanguage}&since=${encodeURIComponent(startOfDay.toISOString())}`),
      ]);
      if (!libraryResponse.ok || !dueResponse.ok || !progressResponse.ok) throw new Error("API unavailable");
      const library = await libraryResponse.json() as { items: LearningItem[] };
      const due = await dueResponse.json() as { items: LearningItem[] };
      const progress = await progressResponse.json() as DailyProgress & { completed: number };
      const dueById = new Map(due.items.map((item) => [item.publicId, item]));
      setItems(library.items.map((item) => dueById.get(item.publicId) || item));
      setDueItemIds(due.items.map((item) => item.publicId));
      setDailyProgress({
        recall: progress.recall ?? progress.completed,
        shadow: progress.shadow ?? 0,
        pattern: progress.pattern ?? 0,
      });
      setApiOnline(true);
      return true;
    } catch {
      setApiOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    setItems([]); setDueItemIds([]); setAttempts({});
    void loadItems(language);
  }, [language, loadItems]);

  const setAnswer = (itemId: string, answer: string) => {
    setAttempts((current) => ({ ...current, [itemId]: { answer } }));
  };

  const checkAnswer = (itemId: string) => {
    const practiceItem = items.find((candidate) => candidate.publicId === itemId);
    const answer = attempts[itemId]?.answer.trim();
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
      setApiOnline(true);
      setDueItemIds((current) => current.filter((publicId) => publicId !== itemId));
      setItems((current) => current.map((candidate) => candidate.publicId === itemId
        ? { ...candidate, schedule: data.attempt.schedule || candidate.schedule } : candidate));
      setAttempts((current) => {
        const next = { ...current }; delete next[itemId]; return next;
      });
      setDailyProgress((progress) => ({ ...progress, recall: progress.recall + 1 }));
      return true;
    } catch {
      setApiOnline(false);
      return false;
    }
  };

  const commitListening = async (itemId: string) => {
    try {
      const response = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, mode: "shadow", rating: "good" }),
      });
      if (!response.ok) throw new Error("Listening activity failed");
      setApiOnline(true);
      setDailyProgress((progress) => ({ ...progress, shadow: progress.shadow + 1 }));
    } catch { setApiOnline(false); }
  };

  const updatePracticeEnabled = async (itemId: string, practiceEnabled: boolean) => {
    try {
      const response = await apiFetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceEnabled }),
      });
      if (!response.ok) throw new Error("Card update failed");
      setItems((current) => current.map((item) => item.publicId === itemId ? { ...item, practiceEnabled } : item));
      if (practiceEnabled) void loadItems(language);
      else setDueItemIds((current) => current.filter((dueId) => dueId !== itemId));
      setApiOnline(true);
      return true;
    } catch { setApiOnline(false); return false; }
  };

  const updateItem = (item: LearningItem) => setItems((current) => current.map((candidate) =>
    candidate.publicId === item.publicId ? { ...candidate, ...item, schedule: candidate.schedule } : candidate));

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
    resetAttempts: () => setAttempts({}),
    setAnswer,
    setApiOnline,
    updateItem,
    updatePracticeEnabled,
  };
};
