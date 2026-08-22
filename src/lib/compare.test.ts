import { describe, expect, it } from "vitest";
import { evaluateAttempt } from "./compare";
import type { PracticeItem } from "../types/practice";

const item: PracticeItem = {
  id: "test",
  language: "en",
  cue: "Тест",
  target: "I've always been drawn to nature.",
  acceptedAnswers: ["I have always been drawn to nature."],
  source: "Test",
  status: "new",
};

describe("evaluateAttempt", () => {
  it("accepts punctuation and casing differences", () => {
    const result = evaluateAttempt(item, "i've always been drawn to nature");
    expect(result.verdict).toBe("exact");
  });

  it("selects the closest accepted variant", () => {
    const result = evaluateAttempt(item, "I have always been drawn to nature");
    expect(result.expected).toBe("I have always been drawn to nature.");
    expect(result.verdict).toBe("exact");
  });

  it("marks missing words for an incomplete answer", () => {
    const result = evaluateAttempt(item, "I've been drawn nature");
    expect(result.expectedTokens.some((token) => token.status === "missing")).toBe(true);
    expect(result.verdict).not.toBe("exact");
  });

  it("treats common unambiguous English contractions as equivalent", () => {
    const contraction = { ...item, target: "We are ready and I will call you.", acceptedAnswers: [] };
    expect(evaluateAttempt(contraction, "We're ready and I'll call you").verdict).toBe("exact");
    expect(evaluateAttempt({ ...item, target: "I am not worried.", acceptedAnswers: [] }, "I'm not worried").verdict).toBe("exact");
    expect(evaluateAttempt({ ...item, target: "He is ready but cannot stay.", acceptedAnswers: [] }, "He's ready but can't stay").verdict).toBe("exact");
  });

  it("keeps a typo local and marks the whole changed word", () => {
    const typo = evaluateAttempt({ ...item, target: "Could you give me an example?", acceptedAnswers: [] }, "Could you give me an exampel");
    expect(typo.answerTokens.at(-1)).toMatchObject({ status: "changed" });
    expect(typo.answerTokens.at(-1)?.parts).toBeUndefined();
    expect(typo.answerTokens.filter((token) => token.status !== "match")).toHaveLength(1);
  });

  it("includes missing words on the learner line for an errors-only diff", () => {
    const result = evaluateAttempt(item, "I've been drawn nature");
    expect(result.answerTokens.some((token) => token.status === "missing")).toBe(true);
  });

  it("treats NFC and NFD Vietnamese as the same answer without ignoring tones", () => {
    const vietnamese: PracticeItem = {
      ...item,
      language: "vi",
      target: "Tôi muốn uống cà phê.",
      acceptedAnswers: [],
    };
    expect(evaluateAttempt(vietnamese, vietnamese.target.normalize("NFD")).verdict).toBe("exact");
    expect(evaluateAttempt(vietnamese, "Toi muon uong ca phe").verdict).not.toBe("exact");
    expect(evaluateAttempt(vietnamese, "Tối muốn uống cà phê.").verdict).not.toBe("exact");
  });

  it("keeps Norwegian diacritics meaningful", () => {
    const norwegian: PracticeItem = { ...item, language: "no", target: "Jeg vil lære å spørre.", acceptedAnswers: [] };
    expect(evaluateAttempt(norwegian, "Jeg vil laere a spørre").verdict).not.toBe("exact");
  });
});
