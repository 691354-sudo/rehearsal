import { describe, expect, it } from "vitest";
import { aiLimits, assertAiSourceWithinBudget, conversationSourceWithinBudget, recentMessagesWithinBudget } from "./ai-limits.js";
import { learnerPersonaForProfile } from "./learner-persona.js";
import { materialInstructions } from "./material-generation.js";
import { tutorInstructions } from "./tutor.js";

describe("learner-specific AI context", () => {
  it("keeps Roman's configured context out of Oliver's prompts", () => {
    const romanTutor = tutorInstructions(learnerPersonaForProfile("roman"), "en");
    const oliverTutor = tutorInstructions(learnerPersonaForProfile("oliver"), "en");
    const zannaTutor = tutorInstructions(learnerPersonaForProfile("zanna"), "en");
    const oliverMaterial = materialInstructions(
      learnerPersonaForProfile("oliver"),
      "en",
      "Create one useful card.",
    );

    expect(romanTutor).toContain("Roman");
    expect(romanTutor).toContain("### Correction");
    expect(romanTutor).toContain("conversational reply before the heading is mandatory");
    expect(romanTutor).toContain("born in 1992");
    expect(oliverTutor).toContain("Oliver");
    expect(oliverTutor).not.toContain("Roman");
    expect(oliverTutor).not.toContain("1992");
    expect(oliverMaterial).not.toContain("Riga");
    expect(oliverMaterial).toContain(String(new Date().getFullYear()));
    expect(zannaTutor).toContain("Zanna");
    expect(zannaTutor).not.toContain("Roman");
  });

  it("keeps the newest whole Tutor messages inside the character budget", () => {
    const messages = [
      { role: "user" as const, content: "old".repeat(20) },
      { role: "assistant" as const, content: "recent answer" },
      { role: "user" as const, content: "new question" },
    ];
    expect(recentMessagesWithinBudget(messages, 50)).toEqual(messages.slice(1));
  });

  it("marks omitted review history and rejects oversized generation sources", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" as const : "user" as const,
      content: "x".repeat(6_000),
    }));
    expect(conversationSourceWithinBudget(messages)).toMatch(/^\[\d+ earlier messages omitted/);
    expect(() => assertAiSourceWithinBudget("x".repeat(aiLimits.sourceCharacters + 1)))
      .toThrow("AI_SOURCE_TOO_LARGE");
  });
});
