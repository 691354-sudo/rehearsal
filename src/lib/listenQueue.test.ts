import { describe, expect, it } from "vitest";
import { buildListenQueue } from "./listenQueue";
import type { LearningItem } from "../shared/contracts";

const items = ["a", "b", "c"].map((publicId) => ({ publicId } as LearningItem));

describe("Listen & Repeat queue", () => {
  it("limits an all-Topic queue", () => {
    expect(buildListenQueue(items, null, 2).map((item) => item.publicId)).toEqual(["a", "b"]);
  });

  it("builds the queue from Topic membership rather than tags", () => {
    const tagged = items.map((item) => ({ ...item, tags: ["not-the-topic"] }));
    expect(buildListenQueue(tagged, new Set(["b", "c"]), "all").map((item) => item.publicId))
      .toEqual(["b", "c"]);
  });

  it("keeps Learned cards available for custom listening", () => {
    const learned = { ...items[0], practiceEnabled: false };
    expect(buildListenQueue([learned], null, "all")).toEqual([learned]);
  });
});
