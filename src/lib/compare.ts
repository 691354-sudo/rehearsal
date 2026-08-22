import type { AttemptEvaluation, DiffToken, PracticeItem } from "../types/practice";
import { normalizeNfc } from "../../contracts/text";

const canonicalContractions = (value: string) => value
  .replace(/\bcan(?:not| not)\b/gu, "can't")
  .replace(/\bwill not\b/gu, "won't")
  .replace(/\bshall not\b/gu, "shan't")
  .replace(/\b(are|is|was|were|do|does|did|have|has|had|could|should|would|must|might|need) not\b/gu, "$1n't")
  .replace(/\bi am\b/gu, "i'm")
  .replace(/\b(you|we|they) are\b/gu, "$1're")
  .replace(/\b(he|she|it|that|there|what|where|who) is\b/gu, "$1's")
  .replace(/\b(i|you|he|she|it|we|they) will\b/gu, "$1'll")
  .replace(/\b(i|you|we|they) have\b/gu, "$1've");

const surfaceNormalise = (value: string) => normalizeNfc(value)
  .toLocaleLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/[^\p{L}\p{N}']+/gu, " ")
  .trim();

const normalise = (value: string) => canonicalContractions(surfaceNormalise(value));

const words = (value: string) => normalise(value).split(/\s+/).filter(Boolean);

const characterDiff = (expected: string, actual: string) => {
  const left = [...expected];
  const right = [...actual];
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const parts = (source: string[], compare: string[]) => {
    const partTable = Array.from({ length: source.length + 1 }, () => Array<number>(compare.length + 1).fill(0));
    for (let sourceIndex = source.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
      for (let compareIndex = compare.length - 1; compareIndex >= 0; compareIndex -= 1) {
        partTable[sourceIndex][compareIndex] = source[sourceIndex] === compare[compareIndex]
          ? partTable[sourceIndex + 1][compareIndex + 1] + 1
          : Math.max(partTable[sourceIndex + 1][compareIndex], partTable[sourceIndex][compareIndex + 1]);
      }
    }
    const result: NonNullable<DiffToken["parts"]> = [];
    let i = 0; let j = 0;
    const push = (value: string, status: "match" | "changed") => {
      const previous = result.at(-1);
      if (previous?.status === status) previous.value += value;
      else result.push({ value, status });
    };
    while (i < source.length) {
      if (j < compare.length && source[i] === compare[j]) { push(source[i], "match"); i += 1; j += 1; }
      else if (j >= compare.length || partTable[i + 1][j] >= partTable[i][j + 1]) { push(source[i], "changed"); i += 1; }
      else j += 1;
    }
    return result;
  };
  const matches = table[0][0];
  return {
    expectedParts: parts(left, right),
    answerParts: parts(right, left),
    similarity: matches / Math.max(left.length, right.length, 1),
  };
};

const buildDiff = (expected: string[], actual: string[]) => {
  const table = Array.from({ length: expected.length + 1 }, () => Array<number>(actual.length + 1).fill(0));
  for (let i = 0; i <= expected.length; i += 1) table[i][0] = i;
  for (let j = 0; j <= actual.length; j += 1) table[0][j] = j;
  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= actual.length; j += 1) {
      if (expected[i - 1] === actual[j - 1]) table[i][j] = table[i - 1][j - 1];
      else {
        const similarity = characterDiff(expected[i - 1], actual[j - 1]).similarity;
        table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (similarity >= 0.45 ? 1 : 2));
      }
    }
  }

  const expectedTokens: DiffToken[] = [];
  const answerTokens: DiffToken[] = [];
  let score = 0; let i = expected.length; let j = actual.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === actual[j - 1]) {
      expectedTokens.unshift({ value: expected[i - 1], status: "match" });
      answerTokens.unshift({ value: actual[j - 1], status: "match" });
      score += 1; i -= 1; j -= 1; continue;
    }
    if (i > 0 && j > 0) {
      const character = characterDiff(expected[i - 1], actual[j - 1]);
      if (character.similarity >= 0.45 && table[i][j] === table[i - 1][j - 1] + 1) {
        expectedTokens.unshift({ value: expected[i - 1], status: "changed", parts: character.expectedParts });
        answerTokens.unshift({ value: actual[j - 1], status: "changed", parts: character.answerParts });
        score += character.similarity; i -= 1; j -= 1; continue;
      }
    }
    if (i > 0 && (j === 0 || table[i][j] === table[i - 1][j] + 1)) {
      expectedTokens.unshift({ value: expected[i - 1], status: "missing" }); i -= 1;
    } else {
      answerTokens.unshift({ value: actual[j - 1], status: "extra" }); j -= 1;
    }
  }
  return { expectedTokens, answerTokens, score };
};

const evaluateCandidate = (expected: string, answer: string): AttemptEvaluation => {
  const expectedWords = words(expected);
  const answerWords = words(answer);
  const diff = buildDiff(expectedWords, answerWords);
  const accuracy = diff.score / Math.max(expectedWords.length, answerWords.length, 1);
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
  return candidates.map((candidate) => ({
    evaluation: evaluateCandidate(candidate, answer),
    surfaceMatch: surfaceNormalise(candidate) === surfaceNormalise(answer),
  })).sort((a, b) => b.evaluation.accuracy - a.evaluation.accuracy
    || Number(b.surfaceMatch) - Number(a.surfaceMatch))[0].evaluation;
};
