import { describe, expect, it } from "vitest";
import { shouldPrepareVocabList, shouldSendTutorOnEnter } from "./tutorInput";

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

describe("Tutor vocabulary input routing", () => {
  const list = "pull through\nbounce back\nturn down\nfigure out\nlook forward to";
  it("prepares a bare vocabulary list in a new chat", () => expect(shouldPrepareVocabList(list, false)).toBe(true));
  it("keeps multiline exercise answers and lists inside an existing conversation", () => {
    expect(shouldPrepareVocabList(list, true)).toBe(false);
    expect(shouldPrepareVocabList("I can pull through.\nI bounced back.\nI turned it down.\nI figured it out.\nI look forward to it.", true)).toBe(false);
  });
  it("does not divert an ordinary first message into card preparation", () => {
    expect(shouldPrepareVocabList("Let's just have a chat about life.", false)).toBe(false);
  });
});
