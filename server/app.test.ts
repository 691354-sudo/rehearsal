import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase, type RehearsalDatabase } from "./db/database.js";
import { RehearsalRepository } from "./db/repository.js";
import { seedDatabase } from "./db/seed.js";

describe("Rehearsal API", () => {
  let tempDir: string;
  let db: RehearsalDatabase;
  let repository: RehearsalRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-test-"));
    db = openDatabase(path.join(tempDir, "test.sqlite"));
    repository = new RehearsalRepository(db);
    seedDatabase(repository);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("seeds both languages and finds phrases with FTS", () => {
    expect(repository.listItems("en", 500).length).toBeGreaterThan(40);
    expect(repository.listItems("lv", 500).length).toBeGreaterThan(10);
    const result = repository.search("follow through", "en");
    expect(result[0]?.target.toLocaleLowerCase()).toMatch(/follow(?:ing)? through/);
  });

  it("evaluates attempts locally and persists the review state without an API key", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe("local");
    expect(response.json().evaluation.verdict).toBe("exact");
    await app.close();
  });

  it("records an explicit memory grade and reports today's recall progress", async () => {
    const app = await buildApp(repository);
    const attempt = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
        rating: "easy",
      },
    });
    expect(attempt.statusCode).toBe(200);
    expect(attempt.json().mode).toBe("local");
    expect(attempt.json().attempt.schedule.state).toBe("review");
    expect(attempt.json().attempt.schedule.dueAt).toBeTruthy();

    const progress = await app.inject({
      method: "GET",
      url: `/api/practice/progress?language=en&since=${encodeURIComponent("2000-01-01T00:00:00.000Z")}`,
    });
    expect(progress.statusCode).toBe(200);
    expect(progress.json().completed).toBe(1);
    await app.close();
  });

  it("records shadowing activity without changing the memory schedule", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/reviews",
      payload: {
        itemId: "en-drawn-to",
        mode: "shadow",
        rating: "hard",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rating).toBe("hard");
    expect(response.json().review.schedule).toBeNull();
    const progress = await app.inject({
      method: "GET",
      url: `/api/practice/progress?language=en&since=${encodeURIComponent("2000-01-01T00:00:00.000Z")}`,
    });
    expect(progress.json()).toMatchObject({ completed: 0, recall: 0, shadow: 1, pattern: 0 });
    await app.close();
  });

  it("removes reviewed cards from the due queue until FSRS makes them due", () => {
    const reviewedAt = new Date("2026-08-18T12:00:00.000Z");
    repository.recordAttempt({
      itemPublicId: "en-drawn-to",
      mode: "recall",
      answer: "I've always been drawn to places near the ocean.",
      score: 1,
      verdict: "easy",
      feedback: {},
      rating: "easy",
      reviewedAt,
    });

    expect(repository.listDueItems("en", 100, new Date("2026-08-19T12:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(false);
    expect(repository.listDueItems("en", 100, new Date("2026-08-27T12:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(true);
  });

  it("updates item preference and prioritizes liked cards in the due queue", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to/preference",
      payload: { preference: "like" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().item.preference).toBe("like");
    expect(repository.listDueItems("en", 100)[0]?.publicId).toBe("en-drawn-to");
    await app.close();
  });

  it("persists card edits, preferences, and deletion across database restarts", async () => {
    const databasePath = path.join(tempDir, "test.sqlite");
    const app = await buildApp(repository);
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
    db.close();

    db = openDatabase(databasePath);
    repository = new RehearsalRepository(db);
    expect(repository.getItem("en-drawn-to")).toMatchObject({
      cue: "Обновлённая подсказка.",
      target: "This updated phrase survives a restart.",
      note: "Edited from the practice card",
      tags: ["persistence"],
      frequencyBand: "core",
      preference: "like",
    });

    const restartedApp = await buildApp(repository);
    const removed = await restartedApp.inject({ method: "DELETE", url: "/api/items/en-drawn-to" });
    expect(removed.statusCode).toBe(204);
    await restartedApp.close();
    db.close();

    db = openDatabase(databasePath);
    repository = new RehearsalRepository(db);
    expect(repository.getItem("en-drawn-to")).toBeNull();
  });

  it("persists editable FSRS settings and exposes them in app config", async () => {
    const app = await buildApp(repository);
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
    const updated = await app.inject({
      method: "PATCH",
      url: "/api/settings/scheduler",
      payload: settings,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().scheduler).toEqual(settings);

    const config = await app.inject({ method: "GET", url: "/api/config" });
    expect(config.statusCode).toBe(200);
    expect(config.json().scheduler).toMatchObject({ algorithm: "FSRS-6", ...settings });
    expect(config.json().tts.providers.openai.voices).toContain("marin");
    expect(config.json().tts.providers.elevenlabs.voice).toEqual({
      id: "1YGgSmpRGVzkcaI7zhbX",
      name: "Christopher",
    });
    await app.close();
  });

  it("rejects unsafe FSRS values", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings/scheduler",
      payload: {
        presets: {
          like: { requestRetention: 0.99, maximumInterval: 60 },
          neutral: { requestRetention: 0.9, maximumInterval: 180 },
          dislike: { requestRetention: 0.87, maximumInterval: 365 },
        },
        learningSteps: ["1 minute"],
        relearningSteps: ["1m", "10m"],
        fuzz: true,
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("keeps the tutor usable as a setup guide before a key is configured", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { language: "en", message: "Help me practice small talk" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().mode).toBe("setup");
    expect(response.json().threadId).toMatch(/[0-9a-f-]{36}/);

    const threadId = response.json().threadId as string;
    const threads = await app.inject({ method: "GET", url: "/api/chat/threads?language=en" });
    expect(threads.statusCode).toBe(200);
    expect(threads.json().threads).toEqual([
      expect.objectContaining({
        publicId: threadId,
        title: "Help me practice small talk",
        messageCount: 2,
      }),
    ]);

    const history = await app.inject({ method: "GET", url: `/api/chat/${threadId}/messages` });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toHaveLength(2);
    expect(history.json().messages[0]).toEqual({ role: "user", content: "Help me practice small talk" });
    await app.close();
  });

  it("keeps LLM proposals out of Library until selected candidates are committed", async () => {
    const before = repository.listItems("en", 500).length;
    const batch = repository.createReviewBatch({
      language: "en",
      kind: "vocab",
      title: "Vocab test",
      candidates: [{
        id: "9ad9bdcb-8309-43cd-8e75-92ed741bb501",
        target: "I tend to bounce back pretty quickly.",
        cue: "Я обычно довольно быстро прихожу в себя.",
        note: "",
        category: "resilience",
        focusTerms: ["bounce back"],
        disposition: "active",
        frequencyBand: "common",
        currency: "current",
        personaFit: 5,
        naturalness: 5,
        commonness: 4,
      }],
    });
    expect(repository.listItems("en", 500)).toHaveLength(before);

    const app = await buildApp(repository);
    const response = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batch.publicId}/commit`,
      payload: { candidates: [{
        id: batch.candidates[0].id,
        target: batch.candidates[0].target,
        cue: batch.candidates[0].cue,
        note: "Useful after setbacks",
        category: "resilience",
      }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().added).toBe(1);
    expect(repository.listItems("en", 500)).toHaveLength(before + 1);
    expect(repository.listItems("en", 500).find((item) => item.target === batch.candidates[0].target)).toMatchObject({
      frequencyBand: "common",
      currency: "current",
      focusTerms: ["bounce back"],
    });
    await app.close();
  });

  it("caps fresh cards without hiding scheduled reviews", () => {
    expect(repository.listDueItems("en", 100, new Date(), 3)
      .filter((item) => item.schedule.state === "new")).toHaveLength(3);
  });
});
