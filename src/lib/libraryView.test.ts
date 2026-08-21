import { describe, expect, it } from "vitest";
import { filterLibraryItems, libraryStatusOf } from "./libraryView";
import type { LearningItem } from "../shared/contracts";

const item = (publicId: string, patch: Partial<LearningItem> = {}) => ({
  publicId,
  target: publicId,
  cue: `cue ${publicId}`,
  note: "",
  practiceEnabled: true,
  ...patch,
} as LearningItem);

describe("Library view", () => {
  it("derives New, Learning, and Learned from schedule and practiceEnabled", () => {
    expect(libraryStatusOf(item("new"))).toBe("new");
    expect(libraryStatusOf(item("learning", { schedule: { dueAt: "2026-08-20T00:00:00Z" } as LearningItem["schedule"] }))).toBe("learning");
    expect(libraryStatusOf(item("learned", { practiceEnabled: false }))).toBe("learned");
  });

  it("filters by Topic membership independently of tags", () => {
    const items = [item("a", { tags: ["same-tag"] }), item("b", { tags: ["same-tag"] })];
    expect(filterLibraryItems(items, { query: "", status: "all", sort: "recent", topicItemIds: new Set(["b"]) })
      .map((value) => value.publicId)).toEqual(["b"]);
  });

  it("puts scheduled cards first when sorting by due date", () => {
    const scheduled = item("scheduled", { schedule: { dueAt: "2026-08-20T00:00:00Z" } as LearningItem["schedule"] });
    expect(filterLibraryItems([item("new"), scheduled], { query: "", status: "all", sort: "due", topicItemIds: null })[0])
      .toBe(scheduled);
  });

  it("normalizes Vietnamese search and uses vi-VN collation for A–Z", () => {
    const targets = ["ư", "ơ", "ô", "o", "ê", "e", "đ", "b", "â", "ă", "a"];
    const items = targets.map((target) => item(target, { language: "vi", target }));
    expect(filterLibraryItems(items, {
      query: "cà phê".normalize("NFD"), status: "all", sort: "recent", topicItemIds: null, language: "vi",
    })).toEqual([]);
    const coffee = item("coffee", { language: "vi", target: "Tôi uống cà phê" });
    expect(filterLibraryItems([coffee], {
      query: "cà phê".normalize("NFD"), status: "all", sort: "recent", topicItemIds: null, language: "vi",
    })).toEqual([coffee]);
    expect(filterLibraryItems(items, {
      query: "", status: "all", sort: "az", topicItemIds: null, language: "vi",
    }).map((value) => value.target)).toEqual(["a", "ă", "â", "b", "đ", "e", "ê", "o", "ô", "ơ", "ư"]);
  });
});
