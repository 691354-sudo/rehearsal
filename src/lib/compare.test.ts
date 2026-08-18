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
});
