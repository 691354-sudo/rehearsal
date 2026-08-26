import { normalizeNfc } from "../../contracts/text.js";
import type { LearningItem } from "../types.js";

export type AttemptEvaluation = {
  score: number;
  verdict: "exact" | "close" | "retry";
  meaningPreserved: boolean;
  naturalAnswer: string;
  correctedAnswer: string;
  summaryRu: string;
  mistakes: Array<{
    original: string;
    correction: string;
    explanationRu: string;
    type: "grammar" | "collocation" | "word_choice" | "missing_word" | "spelling" | "style";
  }>;
};

const normalize = (value: string) =>
  normalizeNfc(value)
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshtein = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

export const localEvaluation = (item: LearningItem, answer: string): AttemptEvaluation => {
  const normalizedAnswer = normalize(answer);
  const best = [item.target, ...item.acceptedAnswers].map((candidate) => {
    const normalizedCandidate = normalize(candidate);
    const distance = levenshtein(normalizedAnswer, normalizedCandidate);
    return { candidate, score: 1 - distance / Math.max(normalizedAnswer.length, normalizedCandidate.length, 1) };
  }).sort((left, right) => right.score - left.score)[0];
  const score = Math.max(0, Math.min(1, best.score));
  const verdict = score >= 0.98 ? "exact" : score >= 0.72 ? "close" : "retry";
  return {
    score,
    verdict,
    meaningPreserved: score >= 0.62,
    naturalAnswer: item.target,
    correctedAnswer: item.target,
    summaryRu: verdict === "exact"
      ? "Точно. Фраза воспроизведена естественно."
      : verdict === "close"
        ? "Смысл понятен. Сравни свой вариант с естественной формулировкой."
        : "Попробуй ещё раз и опирайся на готовую конструкцию целиком.",
    mistakes: [],
  };
};
