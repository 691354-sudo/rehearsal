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

  it("promotes a trailing conversational continuation when the model omitted the required reply", () => {
    expect(splitTutorCorrection("### Correction\n\nwots goting on?\n\n**What’s going on?**\n\nYour version would be:\n\n- **wots goting on?** → **what’s going on?**\n\nIf you want, we can keep it super casual like a real chat.")).toEqual({
      reply: "If you want, we can keep it super casual like a real chat.",
      correction: "wots goting on?\n\n**What’s going on?**\n\nYour version would be:\n\n- **wots goting on?** → **what’s going on?**",
    });
  });

  it("separates the conversational continuation from a verbose legacy correction", () => {
    expect(splitTutorCorrection("A natural way to say it is:\n\n**“What’s going on?”**  \nor more casually: **“What’s up?”**\n\nYour version would be:\n- **wots goting on?** → **what’s going on?**\n\nIf you want, we can keep it super casual like a real chat.", "wots goting on?")).toEqual({
      reply: "If you want, we can keep it super casual like a real chat.",
      correction: "wots goting on?\n\n**“What’s going on?”**  \nor more casually: **“What’s up?”**\n\nYour version would be:\n- **wots goting on?** → **what’s going on?**",
    });
  });
});
