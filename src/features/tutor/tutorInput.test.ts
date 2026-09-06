import { describe, expect, it } from "vitest";
import { shouldSendTutorOnEnter } from "./tutorInput";

describe("Tutor Return", () => {
  const enter = { key: "Enter", shiftKey: false, isComposing: false };
  it("keeps Return available for newlines on phones", () => expect(shouldSendTutorOnEnter(enter, true)).toBe(false));
  it("preserves desktop Enter send and Shift+Enter newline", () => {
    expect(shouldSendTutorOnEnter(enter, false)).toBe(true);
    expect(shouldSendTutorOnEnter({ ...enter, shiftKey: true }, false)).toBe(false);
  });
  it("never sends while confirming an IME composition", () => {
    expect(shouldSendTutorOnEnter({ ...enter, isComposing: true }, false)).toBe(false);
  });
});
