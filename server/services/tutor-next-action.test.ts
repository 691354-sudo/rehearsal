import { describe, expect, it } from "vitest";
import { withGuidedNextAction } from "./tutor-next-action.js";

describe("guided Tutor next actions", () => {
  it.each([
    "### Feedback\nYou have completed the list and successfully reused the target phrases in context.",
    "### Feedback\nYour version is already good. This context round is complete.",
    "### Feedback\nDone.\n\n### Next Task\n ",
  ])("keeps a completed round actionable: %s", (content) => {
    const result = withGuidedNextAction(content, "guided");
    expect(result).toContain("напишите «Дальше»");
    expect(result).toContain("нажмите Create cards");
    expect(withGuidedNextAction(result, "guided")).toBe(result);
  });
  it("preserves an existing exercise and leaves conversation and Homework untouched", () => {
    const task = "### Feedback\nGood.\n\n### Next Task\nПереведи:\n\n> Я буду дома после шести.";
    expect(withGuidedNextAction(task, "guided")).toBe(task);
    for (const mode of ["chat", "homework"]) expect(withGuidedNextAction("We are finished.", mode)).toBe("We are finished.");
  });
});
