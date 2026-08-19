import { describe, expect, it } from "vitest";
import { moveDrillItem, orderDrillItems, reconcileDrillOrder, sortPracticeItems } from "./drillQueue";

describe("drill queue", () => {
  it("keeps saved cards in order, removes stale IDs, and appends new cards", () => {
    expect(reconcileDrillOrder(["a", "b", "c"], ["c", "missing", "a", "c"]))
      .toEqual(["c", "a", "b"]);
  });

  it("orders cards without mutating the source list", () => {
    const items = [{ publicId: "a" }, { publicId: "b" }, { publicId: "c" }];
    expect(orderDrillItems(items, ["b", "a"]).map((item) => item.publicId)).toEqual(["b", "a", "c"]);
    expect(items.map((item) => item.publicId)).toEqual(["a", "b", "c"]);
  });

  it("moves cards relative to the visible filtered queue", () => {
    expect(moveDrillItem(["a", "b", "c", "d"], ["a", "c", "d"], "c", -1))
      .toEqual(["c", "b", "a", "d"]);
    expect(moveDrillItem(["a", "b", "c", "d"], ["a", "c", "d"], "c", 1))
      .toEqual(["a", "b", "d", "c"]);
  });

  it("sorts the full practice inventory without losing manual order", () => {
    const items = [
      { publicId: "a", status: "learning", target: "Zulu" },
      { publicId: "b", status: "new", target: "Alpha" },
      { publicId: "c", status: "strong", target: "Bravo" },
    ];
    expect(sortPracticeItems(items, ["c", "a", "b"], "manual", []).map((item) => item.publicId))
      .toEqual(["c", "a", "b"]);
    expect(sortPracticeItems(items, [], "due-first", ["c"]).map((item) => item.publicId)[0]).toBe("c");
    expect(sortPracticeItems(items, [], "new-first", []).map((item) => item.publicId)[0]).toBe("b");
    expect(sortPracticeItems(items, [], "alphabetical", []).map((item) => item.publicId))
      .toEqual(["b", "c", "a"]);
  });
});
