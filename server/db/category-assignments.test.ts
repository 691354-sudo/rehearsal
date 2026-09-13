import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { applyCategoryAssignments, previewCategoryAssignments, type CategoryAssignmentPlan } from "./category-assignments.js";
import { cardScopeSql } from "./card-scope.js";

describe("reviewed category assignments", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());

  const fixture = () => {
    const repo = context.repository;
    const source = repo.library.createIsland({ language: "en", title: "conditionals" });
    const destinations = ["Health & fitness", "Sport", "Trading & money", "Work & projects", "Travel & places", "Personal stories & reflection"]
      .map((title) => repo.library.createIsland({ language: "en", title: `Migration ${title}` }));
    const destinationIndexes = [0, 0, 0, 0, 1, 2, 3, 4, 4, 5];
    const cards = Array.from({ length: 12 }, (_, index) => repo.items.create({ language: "en",
      target: `If this is example ${index}, I will practise it.`, cue: `Условие ${index}`, focusTerms: ["If"] },
    index < 10 ? source.publicId : destinations[1].publicId));
    repo.practice.recordAttempt({ itemPublicId: cards[0].publicId, mode: "recall", answer: "", verdict: "good", score: 1, feedback: {}, rating: "good" });
    const plan: CategoryAssignmentPlan = { language: "en", categories: [{ publicId: source.publicId, title: "Conditionals",
      description: "Practise conditional constructions", cards: cards.map((card) => ({ publicId: card.publicId, expectedTarget: card.target })) }],
    topicMoves: cards.slice(0, 10).map((card, index) => ({ cardId: card.publicId, fromTopicId: source.publicId,
      toTopicId: destinations[destinationIndexes[index]].publicId })), convertTopics: [{ topicId: source.publicId, categoryId: source.publicId }] };
    return { source, destinations, cards, plan };
  };

  it("converts 10 + 2 cards, preserves set identity, old links, card fields and review history, and is idempotent", () => {
    const { source, cards, plan } = fixture();
    const beforeCards = context.db.prepare("SELECT * FROM items ORDER BY id").all();
    const beforeHistory = context.db.prepare("SELECT * FROM review_state").all();
    expect(previewCategoryAssignments(context.db, plan)).toMatchObject({ applied: false, topicMoves: 10 });
    expect(context.repository.categories.get(source.publicId)).toBeNull();
    expect(applyCategoryAssignments(context.db, plan).applied).toBe(true);
    expect(context.repository.categories.get(source.publicId)?.items.map((item) => item.publicId).sort())
      .toEqual(cards.map((item) => item.publicId).sort());
    expect(context.repository.library.getIsland(source.publicId)).toBeNull();
    expect(context.repository.categories.redirects("en")).toEqual([{ topicId: source.publicId, categoryId: source.publicId }]);
    const scope = cardScopeSql(context.db, "en", { topicId: source.publicId });
    expect(context.db.prepare(`SELECT i.id FROM items i WHERE 1=1 ${scope.sql}`).all(...scope.parameters)).toHaveLength(12);
    expect(context.db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(beforeCards);
    expect(context.db.prepare("SELECT * FROM review_state").all()).toEqual(beforeHistory);
    for (const move of plan.topicMoves) expect(context.repository.items.get(move.cardId)?.topicId).toBe(move.toTopicId);
    expect(applyCategoryAssignments(context.db, plan).applied).toBe(true);
    expect(context.repository.categories.get(source.publicId)?.itemCount).toBe(12);
  });

  it("refuses a changed card or unlisted source member without a partial migration", () => {
    const { source, cards, plan } = fixture();
    context.repository.items.update(cards[1].publicId, { target: "Edited after the audit" });
    expect(() => applyCategoryAssignments(context.db, plan)).toThrow("ASSIGNMENT_CARD_CHANGED");
    expect(context.repository.categories.get(source.publicId)).toBeNull();
    expect(context.repository.library.getIsland(source.publicId)?.itemCount).toBe(10);
    context.repository.items.update(cards[1].publicId, { target: cards[1].target });
    plan.topicMoves.pop();
    expect(() => applyCategoryAssignments(context.db, plan)).toThrow("ASSIGNMENT_SOURCE_NOT_EMPTY");
    expect(context.repository.categories.get(source.publicId)).toBeNull();
  });
});
