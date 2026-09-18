import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { buildLibrarySelection } from "./practiceSelection";

const items = ["a", "b", "c"].map((publicId, index) => ({
  publicId,
  id: index + 1,
  createdAt: `2026-08-23T10:00:0${index}.000Z`,
  practiceEnabled: true,
  preference: "neutral",
  commonness: 0.5,
  personaFit: 0.5,
  progress: { stage: "due", recalls: 1, listens: 0 },
} as LearningItem));

describe("Practice selection", () => {
  it("preserves a Topic's source order for custom practice", () => {
    expect(buildLibrarySelection(items, ["c", "a", "b"], "all", "original")
      .map((item) => item.publicId)).toEqual(["c", "a", "b"]);
  });

  it("can put the newest custom cards first", () => {
    expect(buildLibrarySelection(items, ["a", "b", "c"], "all", "newest")
      .map((item) => item.publicId)).toEqual(["c", "b", "a"]);
  });

  it("keeps Learned cards available only in custom practice", () => {
    const learned = { ...items[0], practiceEnabled: false };
    expect(buildLibrarySelection([learned], null, "all", "newest")).toEqual([learned]);
  });
});
