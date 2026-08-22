import { describe, expect, it } from "vitest";
import { splitTutorCorrection } from "./TutorMarkdownMessage";

describe("splitTutorCorrection", () => {
  it("splits the structured Tutor correction format", () => {
    expect(splitTutorCorrection("Nice. What are you going to have?\n\n### Correction\n\nWrong sentence.\n\n**Natural sentence.**\n\nBrief explanation.")).toEqual({
      reply: "Nice. What are you going to have?",
      correction: "Wrong sentence.\n\n**Natural sentence.**\n\nBrief explanation.",
    });
  });

  it("upgrades legacy More natural replies and restores the learner sentence", () => {
    expect(splitTutorCorrection("Nice 😁 More natural:\n\n**I'm looking forward to having some eggs.**", "Im looking forward for some egs")).toEqual({
      reply: "Nice 😁",
      correction: "Im looking forward for some egs\n\n**I'm looking forward to having some eggs.**",
    });
  });
});
