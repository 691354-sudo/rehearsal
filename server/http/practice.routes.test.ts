import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("practice and library API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("seeds both languages and finds phrases with FTS", () => {
    expect(context.repository.items.list("en", 500).length).toBeGreaterThan(40);
    expect(context.repository.items.list("lv", 500).length).toBeGreaterThan(10);
    expect(context.repository.items.search("follow through", "en")[0]?.target.toLocaleLowerCase())
      .toMatch(/follow(?:ing)? through/);
  });

  it("records recall and listening while changing only the recall schedule", async () => {
    const app = await buildApp(context.repository);
    const recall = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
        rating: "easy",
      },
    });
    expect(recall.statusCode).toBe(200);
    expect(recall.json()).toMatchObject({ mode: "local", evaluation: { verdict: "exact" } });
    expect(recall.json().attempt.schedule).toMatchObject({ state: "review" });

    const shadow = await app.inject({
      method: "POST",
      url: "/api/reviews",
      payload: { itemId: "en-drawn-to", mode: "listen", rating: "hard" },
    });
    expect(shadow.statusCode).toBe(200);
    expect(shadow.json().review.schedule).toBeNull();

    const progress = await app.inject({
      method: "GET",
      url: "/api/practice/progress?language=en&since=2000-01-01T00:00:00.000Z",
    });
    expect(progress.json()).toMatchObject({ completed: 1, recall: 1, shadow: 1, pattern: 0 });
    const inventory = await app.inject({
      method: "GET", url: "/api/items?language=en&limit=500&includeSchedule=true",
    });
    expect(inventory.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to").progress)
      .toMatchObject({ recalls: 1, listens: 1, stage: "strong" });
    const topic = context.repository.library.createIsland({
      language: "en", title: "Progress topic", itemPublicIds: ["en-drawn-to"],
    });
    expect(context.repository.library.getIsland(topic.publicId)?.progress)
      .toMatchObject({ strong: 1, recalls: 1, listens: 1 });
    await app.close();
  });

  it("derives every visible learning stage from FSRS and the Learned flag", () => {
    const reviewedAt = new Date("2026-08-20T12:00:00.000Z");
    const newItem = context.repository.items.save({ language: "en", cue: "Новая", target: "New stage." });
    const learningItem = context.repository.items.save({ language: "en", cue: "Учится", target: "Learning stage." });
    const strongItem = context.repository.items.save({ language: "en", cue: "Сильная", target: "Strong stage." });
    const dueItem = context.repository.items.save({ language: "en", cue: "Пора", target: "Due stage." });
    const learnedItem = context.repository.items.save({ language: "en", cue: "Выучена", target: "Learned stage." });
    context.repository.practice.recordAttempt({ itemPublicId: learningItem.publicId, mode: "recall", answer: learningItem.target,
      score: 0.85, verdict: "good", feedback: {}, rating: "good", reviewedAt });
    context.repository.practice.recordAttempt({ itemPublicId: strongItem.publicId, mode: "recall", answer: strongItem.target,
      score: 1, verdict: "easy", feedback: {}, rating: "easy", reviewedAt });
    context.repository.practice.recordAttempt({ itemPublicId: dueItem.publicId, mode: "recall", answer: dueItem.target,
      score: 1, verdict: "easy", feedback: {}, rating: "easy", reviewedAt: new Date("2020-01-01T00:00:00.000Z") });
    context.repository.items.update(learnedItem.publicId, { practiceEnabled: false });

    const inventory = context.repository.practice.listInventory("en", 500, reviewedAt);
    const stage = (publicId: string) => inventory.find((item) => item.publicId === publicId)?.progress.stage;
    expect(stage(newItem.publicId)).toBe("new");
    expect(stage(learningItem.publicId)).toBe("learning");
    expect(stage(strongItem.publicId)).toBe("strong");
    expect(stage(dueItem.publicId)).toBe("due");
    expect(stage(learnedItem.publicId)).toBe("learned");
  });

  it("returns the full ordered recommendation queue beyond one hundred cards", async () => {
    for (let index = 0; index < 105; index += 1) {
      const item = context.repository.items.save({ language: "en", cue: `Очередь ${index}`, target: `Queue card ${index}.` });
      context.repository.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: item.target,
        score: 1, verdict: "easy", feedback: {}, rating: "easy", reviewedAt: new Date("2020-01-01T00:00:00.000Z") });
    }
    const app = await buildApp(context.repository);
    const response = await app.inject({ method: "GET", url: "/api/practice/due?language=en&limit=2000&newLimit=0" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThanOrEqual(105);
    expect(response.json().composition).toMatchObject({ new: 0 });
    expect(response.json().composition.due).toBe(response.json().items.length);
    await app.close();
  });

  it("validates an explicit focus phrase against the target", async () => {
    const app = await buildApp(context.repository);
    const invalid = await app.inject({
      method: "POST", url: "/api/items",
      payload: { language: "en", cue: "Я справлюсь.", target: "I can pull through.", focusTerms: ["bounce back"] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe("FOCUS_TERM_NOT_FOUND");
    const valid = await app.inject({
      method: "POST", url: "/api/items",
      payload: { language: "en", cue: "Я справлюсь.", target: "I can pull through.", focusTerms: ["pull through"] },
    });
    expect(valid.statusCode).toBe(201);
    expect(valid.json().item.focusTerms).toEqual(["pull through"]);
    await app.close();
  });

  it("keeps Learned cards out of the due queue without deleting their schedule", async () => {
    context.repository.practice.recordAttempt({
      itemPublicId: "en-drawn-to",
      mode: "recall",
      answer: "I've always been drawn to places near the ocean.",
      score: 1,
      verdict: "easy",
      feedback: {},
      rating: "easy",
      reviewedAt: new Date("2026-08-18T12:00:00.000Z"),
    });
    expect(context.repository.practice.listDue("en", 100, new Date("2026-08-19T12:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(false);
    expect(context.repository.practice.listDue("en", 100, new Date("2026-08-27T12:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(true);

    const app = await buildApp(context.repository);
    const learned = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: { practiceEnabled: false },
    });
    expect(learned.json().item.practiceEnabled).toBe(false);
    expect(context.repository.practice.listDue("en", 100, new Date("2030-01-01T00:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(false);
    const inventory = await app.inject({
      method: "GET",
      url: "/api/items?language=en&limit=500&includeSchedule=true",
    });
    expect(inventory.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to"))
      .toMatchObject({ practiceEnabled: false, schedule: { state: "review" } });

    await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
        rating: "good",
      },
    });
    expect(context.repository.items.get("en-drawn-to")?.practiceEnabled).toBe(false);
    const reactivated = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: { practiceEnabled: true },
    });
    expect(reactivated.json().item.practiceEnabled).toBe(true);
    expect(context.repository.practice.listDue("en", 100, new Date("2030-01-01T00:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(true);
    await app.close();
  });

  it("persists edits, preferences, and deletion across database restarts", async () => {
    let app = await buildApp(context.repository);
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: {
        cue: "Обновлённая подсказка.",
        target: "This updated phrase survives a restart.",
        note: "Edited from the practice card",
        tags: ["persistence"],
        frequencyBand: "core",
        preference: "like",
      },
    });
    expect(updated.statusCode).toBe(200);
    await app.close();
    context.reopen();
    expect(context.repository.items.get("en-drawn-to")).toMatchObject({
      cue: "Обновлённая подсказка.",
      target: "This updated phrase survives a restart.",
      tags: ["persistence"],
      preference: "like",
    });

    app = await buildApp(context.repository);
    expect((await app.inject({ method: "DELETE", url: "/api/items/en-drawn-to" })).statusCode).toBe(204);
    await app.close();
    context.reopen();
    expect(context.repository.items.get("en-drawn-to")).toBeNull();
  });

  it("deletes a selected set of Library cards atomically", async () => {
    const first = context.repository.items.save({ language: "en", cue: "Первая", target: "First card." });
    const second = context.repository.items.save({ language: "en", cue: "Вторая", target: "Second card." });
    const app = await buildApp(context.repository);

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/items",
      payload: { itemIds: [first.publicId, "missing-card"] },
    });
    expect(missing.statusCode).toBe(404);
    expect(context.repository.items.get(first.publicId)).not.toBeNull();

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/items",
      payload: { itemIds: [first.publicId, second.publicId] },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toEqual([first.publicId, second.publicId]);
    expect(context.repository.items.get(first.publicId)).toBeNull();
    expect(context.repository.items.get(second.publicId)).toBeNull();
    expect(context.repository.items.get("en-drawn-to")).not.toBeNull();
    await app.close();
  });

  it("persists safe FSRS settings and rejects unsafe values", async () => {
    const app = await buildApp(context.repository);
    const settings = {
      presets: {
        like: { requestRetention: 0.94, maximumInterval: 45 },
        neutral: { requestRetention: 0.91, maximumInterval: 150 },
        dislike: { requestRetention: 0.86, maximumInterval: 320 },
      },
      learningSteps: ["2m", "12m"],
      relearningSteps: ["2m", "12m"],
      fuzz: false,
      newItemsPerDay: 12,
    };
    expect((await app.inject({
      method: "PATCH", url: "/api/settings/scheduler", payload: settings,
    })).json().scheduler).toEqual(settings);
    expect((await app.inject({ method: "GET", url: "/api/config" })).json().scheduler)
      .toMatchObject({ algorithm: "FSRS-6", ...settings });

    const unsafe = await app.inject({
      method: "PATCH",
      url: "/api/settings/scheduler",
      payload: {
        ...settings,
        presets: { ...settings.presets, like: { requestRetention: 0.99, maximumInterval: 60 } },
        learningSteps: ["1 minute"],
      },
    });
    expect(unsafe.statusCode).toBe(400);
    await app.close();
  });

  it("keeps Topic membership independent, ordered, and non-destructive", async () => {
    const first = context.repository.items.save({ language: "en", cue: "А", target: "A.", tags: [" My Topic "] });
    const second = context.repository.items.save({ language: "en", cue: "Б", target: "B.", tags: ["my   topic"] });
    context.repository.library.backfillTopicsFromTags("en");
    context.repository.library.backfillTopicsFromTags("en");
    const backfilled = context.repository.library.listIslands("en")
      .filter((island) => island.title.toLocaleLowerCase().includes("my topic"));
    expect(backfilled).toHaveLength(1);
    expect(context.repository.library.getIsland(backfilled[0].publicId)?.items.map((item) => item.publicId))
      .toEqual([first.publicId, second.publicId]);

    const app = await buildApp(context.repository);
    const created = await app.inject({
      method: "POST",
      url: "/api/islands",
      payload: { language: "en", title: "Manual topic", itemIds: [second.publicId, first.publicId] },
    });
    const islandId = created.json().island.publicId as string;
    const detail = await app.inject({ method: "GET", url: `/api/islands/${islandId}` });
    expect(detail.json().island.items.map((item: { publicId: string }) => item.publicId))
      .toEqual([second.publicId, first.publicId]);
    expect((await app.inject({
      method: "PATCH", url: `/api/islands/${islandId}`, payload: { title: "Renamed topic", itemIds: [first.publicId] },
    })).json().island).toMatchObject({ title: "Renamed topic", itemCount: 1 });
    expect((await app.inject({ method: "DELETE", url: `/api/islands/${islandId}` })).statusCode).toBe(204);
    expect(context.repository.items.get(first.publicId)).not.toBeNull();
    expect(context.repository.items.get(second.publicId)).not.toBeNull();
    await app.close();
  });

  it("prioritizes liked cards in the due queue", async () => {
    const app = await buildApp(context.repository);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to/preference",
      payload: { preference: "like" },
    });
    expect(response.json().item.preference).toBe("like");
    expect(context.repository.practice.listDue("en", 100)[0]?.publicId).toBe("en-drawn-to");
    await app.close();
  });

  it("does not recreate a deleted backfilled Topic after restart", async () => {
    context.repository.items.save({
      language: "en",
      cue: "Удалить тему",
      target: "Delete the topic.",
      tags: ["Temporary tag topic"],
    });
    const app = await buildApp(context.repository);
    const topic = context.repository.library.findIslandByTitle("en", "Temporary tag topic")!;
    expect((await app.inject({ method: "DELETE", url: `/api/islands/${topic.publicId}` })).statusCode).toBe(204);
    await app.close();
    context.reopen();
    const restarted = await buildApp(context.repository);
    expect(context.repository.library.findIslandByTitle("en", "Temporary tag topic")).toBeNull();
    await restarted.close();
  });

  it("caps fresh cards without hiding scheduled reviews", () => {
    expect(context.repository.practice.listDue("en", 100, new Date(), 3)
      .filter((item) => item.schedule.state === "new")).toHaveLength(3);
  });
});
