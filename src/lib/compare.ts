import type { AttemptEvaluation, DiffToken, PracticeItem } from "../types/practice";
import { normalizeNfc } from "../../contracts/text";

const normalise = (value: string) =>
  normalizeNfc(value)
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

const words = (value: string) => normalise(value).split(/\s+/).filter(Boolean);

const buildDiff = (expected: string[], actual: string[]) => {
  const table = Array.from({ length: expected.length + 1 }, () =>
    Array<number>(actual.length + 1).fill(0),
  );

  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = actual.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        expected[i] === actual[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const expectedTokens: DiffToken[] = [];
  const answerTokens: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < expected.length && j < actual.length) {
    if (expected[i] === actual[j]) {
      expectedTokens.push({ value: expected[i], status: "match" });
      answerTokens.push({ value: actual[j], status: "match" });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      expectedTokens.push({ value: expected[i], status: "missing" });
      i += 1;
    } else {
      answerTokens.push({ value: actual[j], status: "extra" });
      j += 1;
    }
  }

  while (i < expected.length) {
    expectedTokens.push({ value: expected[i], status: "missing" });
    i += 1;
  }

  while (j < actual.length) {
    answerTokens.push({ value: actual[j], status: "extra" });
    j += 1;
  }

  return { expectedTokens, answerTokens, matches: table[0][0] };
};

const evaluateCandidate = (expected: string, answer: string): AttemptEvaluation => {
  const expectedWords = words(expected);
  const answerWords = words(answer);
  const diff = buildDiff(expectedWords, answerWords);
  const accuracy = diff.matches / Math.max(expectedWords.length, answerWords.length, 1);

  return {
    expected,
    accuracy,
    expectedTokens: diff.expectedTokens,
    answerTokens: diff.answerTokens,
    verdict: accuracy === 1 ? "exact" : accuracy >= 0.68 ? "close" : "retry",
  };
};

export const evaluateAttempt = (item: PracticeItem, answer: string) => {
  const candidates = [item.target, ...(item.acceptedAnswers ?? [])];
  return candidates
    .map((candidate) => evaluateCandidate(candidate, answer))
    .sort((a, b) => b.accuracy - a.accuracy)[0];
};
