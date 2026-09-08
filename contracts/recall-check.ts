export type RecallCheck = {
  verdict: "correct" | "incorrect";
  explanationRu: string;
  correctedAnswer: string;
  mistakes: Array<{ original: string; correction: string }>;
};

const normalize = (text: string) => text.normalize("NFC").toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();

export const matchesRecallAnswer = (answer: string, candidates: string[]) =>
  Boolean(normalize(answer)) && candidates.some((candidate) => normalize(answer) === normalize(candidate));
