import { describe, expect, it } from "vitest";
import {
  comparableGuidedPracticeTarget,
  guidedPracticeMenuMessage,
  guidedPracticeReviewMessages,
  guidedPracticeStartMessage,
} from "./tutor-guided-practice";

describe("guided practice conversation contract", () => {
  it("reviews only the latest guided session", () => {
    const messages = [
      { role: "user" as const, content: "An older free-chat message" },
      { role: "assistant" as const, content: "An older answer" },
      { role: "user" as const, content: guidedPracticeStartMessage },
      { role: "assistant" as const, content: "Today: Tell it better. Tell me what happened." },
      { role: "user" as const, content: "I ended to stay home." },
    ];

    expect(guidedPracticeReviewMessages(messages)).toEqual(messages.slice(2));
  });

  it("leaves a later explicit card request on the ordinary review path", () => {
    expect(guidedPracticeReviewMessages([
      { role: "user", content: guidedPracticeMenuMessage },
      { role: "assistant", content: "1. Tell it better\n2. Recall & reuse\n3. Role-play twice" },
      { role: "user", content: "Now make five separate cards from these phrases." },
    ])).toBeNull();
  });

  it("normalizes exact Library targets without merging different wording", () => {
    expect(comparableGuidedPracticeTarget("  I ended up staying home.  "))
      .toBe(comparableGuidedPracticeTarget("i ended up staying home."));
    expect(comparableGuidedPracticeTarget("I ended up staying home"))
      .toBe(comparableGuidedPracticeTarget("I ended up staying home."));
    expect(comparableGuidedPracticeTarget("I ended up staying home."))
      .not.toBe(comparableGuidedPracticeTarget("I decided to stay home."));
  });
});
