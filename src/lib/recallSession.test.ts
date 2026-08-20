import { describe, expect, it } from "vitest";
import { initialRecallSession, recallItemIdsAfter, recallKeyAction, recallSessionReducer } from "./recallSession";

const start = (items = ["a", "b", "c", "d"]) => recallSessionReducer(initialRecallSession, {
  type: "start",
  itemIds: items,
});

describe("finite recall session", () => {
  it("requeues Again after one other card", () => {
    expect(recallSessionReducer(start(), { type: "save-succeeded", rating: "again" }).queue)
      .toEqual(["b", "a", "c", "d"]);
  });

  it("requeues Hard after several other cards", () => {
    expect(recallSessionReducer(start(), { type: "save-succeeded", rating: "hard" }).queue)
      .toEqual(["b", "c", "d", "a"]);
  });

  it.each(["good", "easy"] as const)("finishes a card graded %s", (rating) => {
    const state = recallSessionReducer(start(), { type: "save-succeeded", rating });
    expect(state.queue).toEqual(["b", "c", "d"]);
    expect(state.completed).toBe(1);
  });

  it("ends a finite session after the last completed card", () => {
    const state = recallSessionReducer(start(["only"]), { type: "save-succeeded", rating: "good" });
    expect(state).toMatchObject({ phase: "complete", queue: [], completed: 1 });
  });

  it("keeps the card, answer state, and selected grade after a network failure", () => {
    const selected = recallSessionReducer(start(), { type: "select-rating", rating: "hard" });
    const failed = recallSessionReducer(selected, { type: "save-failed" });
    expect(failed).toMatchObject({ phase: "active", queue: ["a", "b", "c", "d"], selectedRating: "hard" });
    expect(failed.error).toContain("Retry");
  });

  it("maps Enter to check and the second Enter to submit", () => {
    expect(recallKeyAction("Enter", false, "good")).toBe("check");
    expect(recallKeyAction("Enter", true, "good")).toBe("submit");
    expect(recallKeyAction("ArrowLeft", true, "good")).toBe("hard");
  });

  it("keeps the following cards in keyboard focus order", () => {
    expect(recallItemIdsAfter(["a", "b", "c"], "a")).toEqual(["b", "c"]);
    expect(recallItemIdsAfter(["a", "b", "c"], "b")).toEqual(["c"]);
    expect(recallItemIdsAfter(["a", "b", "c"], "c")).toEqual([]);
  });
});
