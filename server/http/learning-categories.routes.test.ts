import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("Learning categories", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); context.repository.library.runTopicBackfillMigration(); });
  afterEach(() => context.close());

  it("atomically changes a card's Topic and categories while preserving every legacy Core and FSRS record", async () => {
    const repo = context.repository;
    const item = repo.items.get("en-drawn-to")!;
    repo.items.update(item.publicId, { focusTerms: ["nonliteral legacy core", "second legacy term"] });
    repo.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: "", score: 1, verdict: "good", feedback: {}, rating: "good" });
    const topic = repo.library.createIsland({ language: "en", title: "New context" });
    const category = repo.categories.create({ language: "en", title: "Phrasal verbs" });
    const draft = { publicId: randomUUID(), title: "Use more often", description: "My choice" };
    const before = context.db.prepare("SELECT * FROM review_state WHERE item_id = ?").get(item.id);
    const app = await buildApp(repo);
    const response = await app.inject({ method: "PATCH", url: `/api/items/${item.publicId}`,
      payload: { topicId: topic.publicId, learningCategoryIds: [category.publicId], newLearningCategories: [draft] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().item).toMatchObject({ target: item.target, topicId: topic.publicId,
      focusTerms: ["nonliteral legacy core", "second legacy term"] });
    expect(response.json().item.learningCategoryIds.sort()).toEqual([category.publicId, draft.publicId].sort());
    expect(context.db.prepare("SELECT * FROM review_state WHERE item_id = ?").get(item.id)).toEqual(before);
    expect((await app.inject({ method: "PATCH", url: `/api/items/${item.publicId}`, payload: { target: "Changed target" } })).statusCode).toBe(400);
    await app.close();
  });

  it("rolls back new categories, memberships and text when any requested membership fails", async () => {
    const repo = context.repository;
    const item = repo.items.get("en-drawn-to")!;
    const draft = { publicId: randomUUID(), title: "Draft category", description: "" };
    const app = await buildApp(repo);
    const response = await app.inject({ method: "PATCH", url: `/api/items/${item.publicId}`,
      payload: { cue: "Не сохранять", learningCategoryIds: [randomUUID()], newLearningCategories: [draft] } });
    expect(response.statusCode).toBe(404);
    expect(repo.items.get(item.publicId)).toEqual(item);
    expect(repo.categories.get(draft.publicId)).toBeNull();
    await app.close();
  });

  it("adds memberships without replacing them and deletes only the category", () => {
    const repo = context.repository;
    const item = repo.items.get("en-drawn-to")!;
    const a = repo.categories.create({ language: "en", title: "Phrasal verbs" });
    const b = repo.categories.create({ language: "en", title: "Conversation" });
    repo.categories.addToCards("en", [a.publicId], [item.publicId]);
    repo.categories.addToCards("en", [b.publicId], [item.publicId]);
    repo.categories.addToCards("en", [b.publicId], [item.publicId]);
    expect(repo.items.get(item.publicId)?.learningCategoryIds).toHaveLength(2);
    expect(repo.categories.get(b.publicId)?.itemCount).toBe(1);
    repo.categories.delete(a.publicId);
    expect(repo.items.get(item.publicId)?.learningCategoryIds).toEqual([b.publicId]);
    repo.categories.removeCards(b.publicId, [item.publicId]);
    expect(repo.items.get(item.publicId)?.learningCategoryIds).toEqual([]);
    expect(repo.items.get(item.publicId)?.target).toBe(item.target);
  });

  it("rejects foreign-language categories and duplicate names; category card deletion cascades", async () => {
    const repo = context.repository;
    const item = repo.items.get("en-drawn-to")!;
    const lv = repo.categories.create({ language: "lv", title: "Verbs" });
    expect(() => repo.categories.setForCard(item.publicId, [lv.publicId])).toThrow("CATEGORY_LANGUAGE_MISMATCH");
    expect(() => repo.categories.create({ language: "lv", title: "  VERBS  " })).toThrow("CATEGORY_TITLE_EXISTS");
    const en = repo.categories.create({ language: "en", title: "Verbs" });
    repo.categories.addToCards("en", [en.publicId], [item.publicId]);
    repo.items.delete(item.publicId);
    expect(repo.categories.get(en.publicId)?.itemCount).toBe(0);
    repo.system.setLanguageEnabled("lv", false);
    const app = await buildApp(repo);
    expect((await app.inject({ method: "GET", url: `/api/learning-categories/${lv.publicId}` })).statusCode).toBe(403);
    await app.close();
  });

  it("filters before the new-card cap and keeps separate profiles isolated", () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "lv", title: "Queue contexts" });
    const category = repo.categories.create({ language: "lv", title: "Queue focus" });
    const item = repo.items.create({ language: "lv", target: "Labdien!", cue: "Добрый день", learningCategoryIds: [category.publicId] }, topic.publicId);
    expect(repo.pilot.queue.list({ language: "lv", limit: 1, categoryId: category.publicId }).map((entry) => entry.publicId)).toEqual([item.publicId]);
    const other = createApiTestContext();
    try {
      expect(other.repository.categories.get(category.publicId)).toBeNull();
      expect(() => other.repository.categories.addToCards("lv", [category.publicId], [])).toThrow("CATEGORY_NOT_FOUND");
    } finally { other.close(); }
  });

  it("retries manual creation with the same id without duplicating the card or its draft category", async () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "en", title: "Retry context" });
    const app = await buildApp(repo);
    const payload = { publicId: randomUUID(), language: "en", target: "Try again", cue: "Попробуй снова", topicId: topic.publicId,
      newLearningCategories: [{ publicId: randomUUID(), title: "Retry category", description: "" }] };
    const first = await app.inject({ method: "POST", url: "/api/items", payload });
    const second = await app.inject({ method: "POST", url: "/api/items", payload });
    expect(first.statusCode).toBe(201);
    expect(second.json().item.publicId).toBe(first.json().item.publicId);
    expect(repo.library.getIsland(topic.publicId)?.itemCount).toBe(1);
    expect(repo.categories.catalog("en")).toHaveLength(1);
    const changed = { ...payload, newLearningCategories: [{ publicId: randomUUID(), title: "Changed retry", description: "" }] };
    expect((await app.inject({ method: "POST", url: "/api/items", payload: changed })).statusCode).toBe(409);
    expect(repo.categories.catalog("en")).toHaveLength(1);
    await app.close();
  });

  it("filters English Recall before limits, keeps admission rules, and deleting an active card writes no grade", () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "en", title: "English category queue" });
    const category = repo.categories.create({ language: "en", title: "Recall focus" });
    const eligible = repo.items.create({ language: "en", target: "An eligible card", cue: "Для повторения", learningCategoryIds: [category.publicId] }, topic.publicId);
    const fresh = repo.items.create({ language: "en", target: "A fresh card", cue: "Новая", learningCategoryIds: [category.publicId] }, topic.publicId);
    const outside = repo.items.create({ language: "en", target: "Outside category", cue: "Снаружи" }, topic.publicId);
    for (const item of [eligible, outside]) repo.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: "", verdict: "good",
      score: 1, feedback: {}, rating: "good", reviewedAt: new Date("2020-01-01T00:00:00Z") });
    for (const item of [eligible, outside]) repo.pilot.listening.toRecall({eventId:randomUUID(),cardId:item.publicId,language:"en"});
    expect(repo.pilot.queue.list({ categoryId: category.publicId, limit: 1 }).map((item) => item.publicId)).toEqual([eligible.publicId]);
    expect(repo.pilot.queue.list({ categoryId: category.publicId }).some((item) => item.publicId === fresh.publicId)).toBe(false);
    const attemptId = randomUUID();
    repo.pilot.recall.begin({ attemptId, cardId: eligible.publicId, shownAt: new Date().toISOString(), timezone: "Europe/Riga" });
    repo.items.delete(eligible.publicId);
    expect(repo.pilot.recall.get(attemptId)).toBeUndefined();
    expect(context.db.prepare("SELECT * FROM attempts WHERE item_id = ?").all(eligible.id)).toEqual([]);
    expect(context.db.prepare("SELECT * FROM review_state WHERE item_id = ?").all(eligible.id)).toEqual([]);
    expect(repo.pilot.queue.list({ categoryId: category.publicId })).toEqual([]);
    expect(repo.items.get(outside.publicId)).not.toBeNull();
  });
});
