import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";
import { reviewCandidate } from "../../testing/candidates.js";

describe("Review category ownership", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());

  it("applies confirmed Core and categories, preserving the legacy Review selection contract", () => {
    const repo = context.repository;
    const original = reviewCandidate();
    const category = repo.categories.create({ language: "en", title: "Conversational phrases" });
    const batch = repo.reviews.create({ language: "en", kind: "vocab", title: "Review test", candidates: [original] });
    const result = repo.reviews.commit(batch.publicId, [{ ...original, focusTerms: ["a moment"], learningCategoryIds: [category.publicId] }]);
    expect(result?.items[0]).toMatchObject({ focusTerms: ["a moment"], learningCategoryIds: [category.publicId] });
    expect(repo.reviews.commit(batch.publicId, [original])?.items).toEqual([]);
  });

  it("adds memberships to an existing card instead of duplicating or moving it", () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "en", title: "Original context" });
    const item = repo.items.create({ language: "en", target: "Could you give me a moment?", cue: "Старый перевод", focusTerms: ["give me"] }, topic.publicId);
    const a = repo.categories.create({ language: "en", title: "Existing focus" });
    repo.categories.addToCards("en", [a.publicId], [item.publicId]);
    const candidate = reviewCandidate({ newLearningCategories: [{ publicId: randomUUID(), title: "Conversational phrases", description: "Requests" }] });
    const batch = repo.reviews.create({ language: "en", kind: "capture", title: "Reviewed note", candidates: [candidate] });
    const count = repo.items.list("en", 10_000).length;
    const committed = repo.reviews.commit(batch.publicId, [candidate])!.items[0];
    expect(committed).toMatchObject({ publicId: item.publicId, topicId: topic.publicId, cue: "Старый перевод", focusTerms: ["give me"] });
    expect(committed.learningCategoryIds).toHaveLength(2);
    expect(repo.items.list("en", 10_000)).toHaveLength(count);
    expect(repo.library.findIslandByTitle("en", candidate.category)).toBeNull();
  });

  it("does not save excluded proposals or their categories and rolls back an invalid batch", () => {
    const repo = context.repository;
    const a = reviewCandidate({ id: randomUUID(), newLearningCategories: [{ publicId: randomUUID(), title: "Excluded category", description: "" }] });
    const b = reviewCandidate({ id: randomUUID(), target: "Another phrase", focusTerms: [], learningCategoryIds: [randomUUID()] });
    const batch = repo.reviews.create({ language: "en", kind: "vocab", title: "Selection", candidates: [a, b] });
    const before = repo.items.list("en", 10_000).length;
    expect(() => repo.reviews.commit(batch.publicId, [a, b])).toThrow("CATEGORY_NOT_FOUND");
    expect(repo.categories.catalog("en")).toEqual([]);
    expect(repo.items.list("en", 10_000)).toHaveLength(before);
    repo.reviews.commit(batch.publicId, []);
    expect(repo.categories.catalog("en")).toEqual([]);
    expect(repo.items.list("en", 10_000)).toHaveLength(before);
  });
});
