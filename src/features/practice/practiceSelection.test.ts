import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { buildPracticeSelection } from "./practiceSelection";

const items = ["a", "b", "c"].map((publicId) => ({ publicId } as LearningItem));

describe("Practice selection", () => {
  it("uses the complete ordered due queue by default", () => {
    expect(buildPracticeSelection(items, ["c", "a"], null, "all", "due").map((item) => item.publicId))
      .toEqual(["c", "a"]);
  });

  it("applies Topic membership and count to due cards", () => {
    expect(buildPracticeSelection(items, ["c", "b", "a"], new Set(["a", "b"]), 1, "due")
      .map((item) => item.publicId)).toEqual(["b"]);
  });

  it("keeps Learned cards available only in custom practice", () => {
    const learned = { ...items[0], practiceEnabled: false };
    expect(buildPracticeSelection([learned], [], null, "all", "due")).toEqual([]);
    expect(buildPracticeSelection([learned], [], null, "all", "custom")).toEqual([learned]);
  });
});
