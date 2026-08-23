import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { buildPracticeSelection } from "./practiceSelection";

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
  it("uses the complete ordered due queue by default", () => {
    expect(buildPracticeSelection(items, ["c", "a"], null, "all", "due", "original").map((item) => item.publicId))
      .toEqual(["c", "a"]);
  });

  it("applies Topic membership and count to due cards", () => {
    expect(buildPracticeSelection(items, ["c", "b", "a"], ["a", "b"], 1, "due", "newest")
      .map((item) => item.publicId)).toEqual(["b"]);
  });

  it("builds a Topic recommendation after the global new-card cap", () => {
    const global = { ...items[2], practiceEnabled: true, progress: { stage: "new", recalls: 0, listens: 0 } } as LearningItem;
    const exposed = { ...items[0], practiceEnabled: true, progress: { stage: "new", recalls: 0, listens: 3 } } as LearningItem;
    const unseen = { ...items[1], practiceEnabled: true, progress: { stage: "new", recalls: 0, listens: 0 } } as LearningItem;
    expect(buildPracticeSelection([exposed, unseen, global], ["c"], ["a", "b"], "all", "due", "newest", 1)
      .map((item) => item.publicId)).toEqual(["a"]);
  });

  it("preserves a Topic's source order for custom practice", () => {
    expect(buildPracticeSelection(items, [], ["c", "a", "b"], "all", "custom", "original")
      .map((item) => item.publicId)).toEqual(["c", "a", "b"]);
  });

  it("can put the newest custom cards first", () => {
    expect(buildPracticeSelection(items, [], ["a", "b", "c"], "all", "custom", "newest")
      .map((item) => item.publicId)).toEqual(["c", "b", "a"]);
  });

  it("keeps Learned cards available only in custom practice", () => {
    const learned = { ...items[0], practiceEnabled: false };
    expect(buildPracticeSelection([learned], [], null, "all", "due", "newest")).toEqual([]);
    expect(buildPracticeSelection([learned], [], null, "all", "custom", "newest")).toEqual([learned]);
  });
});
