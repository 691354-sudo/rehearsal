import { describe, expect, it } from "vitest";
import { moveReviewedItem, moveReviewRating, ratingFromVerdict } from "./sessionQueue";

describe("session queue", () => {
  const items = ["current", "next", "later", "last"];

  it("brings an Again item back after one other card", () => {
    expect(moveReviewedItem(items, "again")).toEqual([
      "next",
      "current",
      "later",
      "last",
    ]);
  });

  it("keeps Hard nearer and lets the default Good move to the end", () => {
    expect(moveReviewedItem(items, "hard")).toEqual([
      "next",
      "later",
      "current",
      "last",
    ]);
    expect(moveReviewedItem(items, "good")).toEqual([
      "next",
      "later",
      "last",
      "current",
    ]);
  });

  it("can review a card selected from anywhere in the feed", () => {
    expect(moveReviewedItem(items, "good", 2)).toEqual([
      "current",
      "next",
      "last",
      "later",
    ]);
    expect(moveReviewedItem(items, "again", 3)).toEqual([
      "current",
      "last",
      "next",
      "later",
    ]);
  });

  it("maps recall results to review grades", () => {
    expect(ratingFromVerdict("retry")).toBe("again");
    expect(ratingFromVerdict("close")).toBe("hard");
    expect(ratingFromVerdict("exact")).toBe("good");
  });

  it("moves the keyboard-selected grade without wrapping past the ends", () => {
    expect(moveReviewRating("good", -1)).toBe("hard");
    expect(moveReviewRating("good", 1)).toBe("easy");
    expect(moveReviewRating("again", -1)).toBe("again");
    expect(moveReviewRating("easy", 1)).toBe("easy");
  });
});
