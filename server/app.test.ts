import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase, type RehearsalDatabase } from "./db/database.js";
import { RehearsalRepository } from "./db/repository.js";
import { seedDatabase } from "./db/seed.js";
import { OpenAIService } from "./services/openai.js";
import type { ElevenLabsService } from "./services/elevenlabs.js";

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

  it("returns schedule inventory and preserves it while a card is Learned", async () => {
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
    const app = await buildApp(repository);
    const inventory = await app.inject({
      method: "GET",
      url: "/api/items?language=en&limit=500&includeSchedule=true",
    });
    const scheduled = inventory.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to");
    expect(scheduled.schedule).toMatchObject({ state: "review" });

    const learned = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: { practiceEnabled: false },
    });
    expect(learned.json().item.practiceEnabled).toBe(false);
    expect(repository.listDueItems("en", 100, new Date("2026-08-27T12:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(false);

    const learnedInventory = await app.inject({
      method: "GET",
      url: "/api/items?language=en&limit=500&includeSchedule=true",
    });
    expect(learnedInventory.json().items.find((item: { publicId: string }) => item.publicId === "en-drawn-to"))
      .toMatchObject({ practiceEnabled: false, schedule: { state: "review" } });

    const manualReview = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: {
        itemId: "en-drawn-to",
        answer: "I've always been drawn to places near the ocean.",
        mode: "recall",
        rating: "good",
      },
    });
    expect(manualReview.statusCode).toBe(200);
    expect(repository.getItem("en-drawn-to")?.practiceEnabled).toBe(false);
    expect(repository.listDueItems("en", 100, new Date("2030-01-01T00:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(false);

    const reactivated = await app.inject({
      method: "PATCH",
      url: "/api/items/en-drawn-to",
      payload: { practiceEnabled: true },
    });
    expect(reactivated.json().item.practiceEnabled).toBe(true);
    expect(repository.listDueItems("en", 100, new Date("2030-01-01T00:00:00.000Z"))
      .some((item) => item.publicId === "en-drawn-to")).toBe(true);
    await app.close();
  });

  it("keeps Topic membership independent from item tags", () => {
    const item = repository.saveItem({
      language: "en",
      cue: "Здесь занято?",
      target: "Is this taken?",
      tags: ["question pattern"],
    });
    const topic = repository.createIsland({ language: "en", title: "Gym", itemPublicIds: [item.publicId] });
    expect(repository.getIsland(topic.publicId)?.items[0]).toMatchObject({
      publicId: item.publicId,
      tags: ["question pattern"],
    });
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
    expect(config.json().tts.providers.elevenlabs.speedRange).toEqual({ min: 0.7, max: 1.2 });
    await app.close();
  });

  it("reports whether the configured ElevenLabs voice is actually reachable", async () => {
    const voiceStatus = vi.fn().mockResolvedValue({
      configured: true,
      reachable: true,
      checkedAt: "2026-08-19T12:00:00.000Z",
      voice: {
        id: "voice-id",
        name: "Verified voice",
        category: "professional",
        description: "A test voice",
        labels: { accent: "american" },
      },
      error: "",
    });
    const elevenlabs = { voiceStatus } as unknown as ElevenLabsService;
    const app = await buildApp(repository, { elevenlabs });

    const response = await app.inject({ method: "GET", url: "/api/audio/elevenlabs/status?refresh=true" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ reachable: true, voice: { name: "Verified voice" } });
    expect(voiceStatus).toHaveBeenCalledWith(true);
    await app.close();
  });

  it("rejects ElevenLabs speeds outside the provider API range before synthesis", async () => {
    const app = await buildApp(repository);
    const response = await app.inject({
      method: "POST",
      url: "/api/audio/speech",
      payload: { text: "Too fast", language: "en", provider: "elevenlabs", speed: 1.5 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_ELEVENLABS_SPEED" });
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
    const openai = new OpenAIService(repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(repository, { openai });
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

  it("keeps a dismissed pattern drill out of Library and commits only selected variants", async () => {
    const before = repository.listItems("en", 500).length;
    const openai = new OpenAIService(repository);
    vi.spyOn(openai, "generatePatternDrill").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: repository.createReviewBatch({
        language,
        kind: "pattern_drill",
        title: "Pattern: I've always been drawn to…",
        candidates: [
          {
            id: "9ad9bdcb-8309-43cd-8e75-92ed741bb521",
            target: "I've always been drawn to quiet coastal towns.",
            cue: "Меня всегда тянуло к тихим приморским городам.",
            note: "Keep the pattern; change the meaningful slot.",
            category: "travel",
            focusTerms: ["be drawn to"],
            disposition: "active",
            frequencyBand: "common",
            currency: "current",
            personaFit: 5,
            naturalness: 5,
            commonness: 5,
          },
          {
            id: "9ad9bdcb-8309-43cd-8e75-92ed741bb522",
            target: "I've always been drawn to people who speak their mind.",
            cue: "Меня всегда тянуло к людям, которые говорят прямо.",
            note: "Keep the pattern; change the meaningful slot.",
            category: "relationships",
            focusTerms: ["be drawn to"],
            disposition: "active",
            frequencyBand: "common",
            currency: "current",
            personaFit: 5,
            naturalness: 5,
            commonness: 5,
          },
        ],
      }),
    }));
    const app = await buildApp(repository, { openai });

    const prepared = await app.inject({ method: "POST", url: "/api/items/en-drawn-to/pattern-drill" });
    expect(prepared.statusCode).toBe(201);
    const batch = prepared.json().batch;
    expect(batch.kind).toBe("pattern_drill");
    expect(repository.listItems("en", 500)).toHaveLength(before);

    const selected = batch.candidates[1];
    const committed = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batch.publicId}/commit`,
      payload: { candidates: [{
        id: selected.id,
        target: selected.target,
        cue: selected.cue,
        note: selected.note,
        category: selected.category,
      }] },
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().added).toBe(1);
    const after = repository.listItems("en", 500);
    expect(after).toHaveLength(before + 1);
    expect(after.some((item) => item.target === batch.candidates[0].target)).toBe(false);
    expect(after.find((item) => item.target === selected.target)).toMatchObject({
      tags: ["be drawn to"],
    });
    await app.close();
  });

  it("records a Russian voice note through OpenAI and deletes audio after transcription", async () => {
    const openai = new OpenAIService(repository);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Я хочу спокойно объяснить свою позицию.");
    const app = await buildApp(repository, { openai });
    const boundary = "----rehearsal-capture-test";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.webm"\r\n` +
      "Content-Type: audio/webm\r\n\r\nfake-webm-audio\r\n" +
      `--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/captures?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().note).toMatchObject({
      language: "en",
      transcript: "Я хочу спокойно объяснить свою позицию.",
      status: "ready",
    });
    expect(repository.getCaptureAudio(response.json().note.publicId)?.audio).toBeNull();
    await app.close();
  });

  it("creates a ready text capture without calling OpenAI", async () => {
    const openai = new OpenAIService(repository);
    const transcribe = vi.spyOn(openai, "transcribe");
    const app = await buildApp(repository, { openai });
    const response = await app.inject({
      method: "POST",
      url: "/api/captures/text",
      payload: { language: "en", transcript: "  Я хочу заказать кофе без молока.  " },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().note).toMatchObject({
      language: "en",
      transcript: "Я хочу заказать кофе без молока.",
      status: "ready",
      audioMime: "",
    });
    expect(transcribe).not.toHaveBeenCalled();
    await app.close();
  });

  it("edits and deletes a text capture before review", async () => {
    const app = await buildApp(repository);
    const created = await app.inject({
      method: "POST",
      url: "/api/captures/text",
      payload: { language: "lv", transcript: "Я хочу говорить точнее." },
    });
    const noteId = created.json().note.publicId as string;
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/captures/${noteId}`,
      payload: { transcript: "Я хочу говорить по-латышски точнее." },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().note.transcript).toBe("Я хочу говорить по-латышски точнее.");
    expect((await app.inject({ method: "DELETE", url: `/api/captures/${noteId}` })).statusCode).toBe(204);
    expect(repository.getCaptureNote(noteId)).toBeNull();
    await app.close();
  });

  it("retains failed capture audio for retry, then clears it after success", async () => {
    const openai = new OpenAIService(repository);
    const transcribe = vi.spyOn(openai, "transcribe")
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("Повторная расшифровка сработала.");
    const app = await buildApp(repository, { openai });
    const boundary = "----rehearsal-capture-retry";
    const response = await app.inject({
      method: "POST",
      url: "/api/captures?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.m4a"\r\n` +
        "Content-Type: audio/mp4\r\n\r\nfake-m4a-audio\r\n" +
        `--${boundary}--\r\n`,
      ),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().note.status).toBe("failed");
    const noteId = response.json().note.publicId as string;
    expect(repository.getCaptureAudio(noteId)?.audio?.byteLength).toBeGreaterThan(0);

    const retry = await app.inject({ method: "POST", url: `/api/captures/${noteId}/retry` });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().note).toMatchObject({ status: "ready", transcript: "Повторная расшифровка сработала." });
    expect(repository.getCaptureAudio(noteId)?.audio).toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("rejects empty, unsupported, and oversized capture uploads", async () => {
    const openai = new OpenAIService(repository);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Не должно вызываться.");
    const app = await buildApp(repository, { openai });
    const request = async (mime: string, audio: Buffer) => {
      const boundary = `----capture-validation-${mime.replace(/\W/g, "")}`;
      return app.inject({
        method: "POST", url: "/api/captures?language=en",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.bin"\r\nContent-Type: ${mime}\r\n\r\n`),
          audio,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    expect((await request("audio/mp4", Buffer.alloc(0))).statusCode).toBe(422);
    expect((await request("text/plain", Buffer.from("not audio"))).statusCode).toBe(415);
    expect((await request("audio/mp4", Buffer.alloc(25 * 1024 * 1024 + 1))).statusCode).toBe(413);
    expect(openai.transcribe).not.toHaveBeenCalled();
    await app.close();
  }, 20_000);

  it("selects the oldest capture notes that fit the 50,000 character window", () => {
    const makeReady = (text: string) => {
      const note = repository.createCaptureNote({ language: "en", audio: Buffer.from("audio"), audioMime: "audio/webm" });
      repository.completeCaptureTranscription(note.publicId, text);
      return note.publicId;
    };
    const oldest = makeReady("a".repeat(30_000));
    makeReady("b".repeat(20_001));
    makeReady("c".repeat(10));
    const selection = repository.selectReadyCaptureNotes("en", 50_000);
    expect(selection.notes.map((note) => note.publicId)).toEqual([oldest]);
    expect(selection.remaining).toBe(2);
  });

  it("turns multiple capture notes into one revisable batch and commits it atomically", async () => {
    const first = repository.createTextCaptureNote({ language: "en", transcript: "Я хотел попросить клиента немного подождать." });
    const second = repository.createCaptureNote({ language: "en", audio: Buffer.from("two"), audioMime: "audio/webm" });
    repository.completeCaptureTranscription(second.publicId, "Я хотел объяснить, что срок изменился.");

    const openai = new OpenAIService(repository);
    const prepareCaptureBatch = vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: repository.createReviewBatch({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [{
          id: "9ad9bdcb-8309-43cd-8e75-92ed741bb511",
          target: "Could you wait a moment?",
          cue: "Можешь немного подождать?",
          note: "",
          category: "Client work",
          focusTerms: ["wait a moment"],
          disposition: "active",
          frequencyBand: "core",
          currency: "current",
          personaFit: 5,
          naturalness: 5,
          commonness: 5,
        }],
      }),
    }));
    vi.spyOn(openai, "reviseReviewBatch").mockImplementation(async ({ batchPublicId, feedback }) => {
      const batch = repository.getReviewBatch(batchPublicId)!;
      return repository.replaceReviewCandidates(batchPublicId, [{
        ...batch.candidates[0],
        target: "Could you give me a moment?",
      }], feedback);
    });
    const app = await buildApp(repository, { openai });
    const prepared = await app.inject({ method: "POST", url: "/api/captures/process", payload: { language: "en" } });
    expect(prepared.statusCode).toBe(201);
    expect(prepareCaptureBatch.mock.calls[0][0].notes.map((note) => note.transcript)).toEqual([
      "Я хотел попросить клиента немного подождать.",
      "Я хотел объяснить, что срок изменился.",
    ]);
    const batchId = prepared.json().batch.publicId as string;
    expect(repository.listCaptureNotes("en").every((note) => note.status === "batched")).toBe(true);

    const revised = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/revise`,
      payload: { feedback: "Первая фраза слишком формальная." },
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json().batch.candidates[0].target).toBe("Could you give me a moment?");

    const candidate = revised.json().batch.candidates[0];
    const committed = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/commit`,
      payload: { candidates: [{
        id: candidate.id,
        target: candidate.target,
        cue: candidate.cue,
        note: candidate.note,
        category: candidate.category,
      }] },
    });
    expect(committed.statusCode).toBe(200);
    expect(committed.json().added).toBe(1);
    expect(repository.listCaptureNotes("en", true).filter((note) =>
      [first.publicId, second.publicId].includes(note.publicId)
    ).every((note) => note.status === "processed")).toBe(true);
    expect(repository.listItems("en", 500).find((item) => item.target === "Could you give me a moment?")?.tags)
      .toEqual(["wait a moment"]);
    const captureTopic = repository.findIslandByTitle("en", "Client work");
    expect(captureTopic).not.toBeNull();
    expect(repository.getIsland(captureTopic!.publicId)?.items.map((item) => item.target))
      .toContain("Could you give me a moment?");
    await app.close();
  });

  it("completes the personal sentence loop from Notebook through Learned and reactivation", async () => {
    const openai = new OpenAIService(repository);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Я хочу спросить, можем ли мы заниматься на этом тренажёре вместе.");
    const prepareCaptureBatch = vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: repository.createReviewBatch({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [{
          id: "9ad9bdcb-8309-43cd-8e75-92ed741bb531",
          target: "Could we share this machine?",
          cue: "Мы можем вместе заниматься на этом тренажёре?",
          note: "At the gym",
          category: "gym",
          pattern: "Could we…?",
          focusTerms: ["share this machine"],
          disposition: "active",
          frequencyBand: "core",
          currency: "current",
          personaFit: 5,
          naturalness: 5,
          commonness: 5,
        }],
      }),
    }));
    const app = await buildApp(repository, { openai });

    const typed = await app.inject({
      method: "POST",
      url: "/api/captures/text",
      payload: { language: "en", transcript: "Здесь занято?" },
    });
    expect(typed.statusCode).toBe(201);
    const boundary = "----rehearsal-loop-voice";
    const voice = await app.inject({
      method: "POST",
      url: "/api/captures?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="gym.webm"\r\n` +
        "Content-Type: audio/webm\r\n\r\nvoice-note\r\n" +
        `--${boundary}--\r\n`,
      ),
    });
    expect(voice.statusCode).toBe(201);

    const prepared = await app.inject({ method: "POST", url: "/api/captures/process", payload: { language: "en" } });
    expect(prepared.statusCode).toBe(201);
    expect(prepareCaptureBatch.mock.calls[0][0].notes.map((note) => note.transcript)).toEqual([
      "Здесь занято?",
      "Я хочу спросить, можем ли мы заниматься на этом тренажёре вместе.",
    ]);
    const candidate = prepared.json().batch.candidates[0];
    const committed = await app.inject({
      method: "POST",
      url: `/api/review-batches/${prepared.json().batch.publicId}/commit`,
      payload: { candidates: [{
        id: candidate.id,
        target: candidate.target,
        cue: candidate.cue,
        note: candidate.note,
        category: candidate.category,
      }] },
    });
    expect(committed.statusCode).toBe(200);
    const itemId = committed.json().items[0].publicId as string;

    const topics = await app.inject({ method: "GET", url: "/api/islands?language=en" });
    const gym = topics.json().islands.find((topic: { title: string }) => topic.title === "gym");
    const gymDetail = await app.inject({ method: "GET", url: `/api/islands/${gym.publicId}` });
    expect(gymDetail.json().island.items.map((item: { publicId: string }) => item.publicId)).toContain(itemId);

    const listened = await app.inject({
      method: "POST",
      url: "/api/reviews",
      payload: { itemId, mode: "shadow", rating: "good" },
    });
    expect(listened.json().review.schedule).toBeNull();
    const afterListening = await app.inject({
      method: "GET",
      url: "/api/items?language=en&limit=500&includeSchedule=true",
    });
    expect(afterListening.json().items.find((item: { publicId: string }) => item.publicId === itemId).schedule).toBeUndefined();

    const recalled = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: { itemId, answer: "Could we share this machine?", mode: "recall", rating: "good" },
    });
    expect(recalled.statusCode).toBe(200);
    expect(recalled.json().attempt.schedule.dueAt).toBeTruthy();
    db.prepare("UPDATE review_state SET due_at = '2000-01-01T00:00:00.000Z' WHERE item_id = (SELECT id FROM items WHERE public_id = ?)")
      .run(itemId);

    const learned = await app.inject({
      method: "PATCH",
      url: `/api/items/${itemId}`,
      payload: { practiceEnabled: false },
    });
    expect(learned.json().item.practiceEnabled).toBe(false);
    const dueWhileLearned = await app.inject({ method: "GET", url: "/api/practice/due?language=en&limit=100" });
    expect(dueWhileLearned.json().items.some((item: { publicId: string }) => item.publicId === itemId)).toBe(false);

    const manualReview = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: { itemId, answer: "Could we share this machine?", mode: "recall", rating: "easy" },
    });
    expect(manualReview.statusCode).toBe(200);
    expect(repository.getItem(itemId)?.practiceEnabled).toBe(false);
    db.prepare("UPDATE review_state SET due_at = '2000-01-01T00:00:00.000Z' WHERE item_id = (SELECT id FROM items WHERE public_id = ?)")
      .run(itemId);

    const reactivated = await app.inject({
      method: "PATCH",
      url: `/api/items/${itemId}`,
      payload: { practiceEnabled: true },
    });
    expect(reactivated.json().item.practiceEnabled).toBe(true);
    const dueAfterReactivation = await app.inject({ method: "GET", url: "/api/practice/due?language=en&limit=100" });
    expect(dueAfterReactivation.json().items.some((item: { publicId: string }) => item.publicId === itemId)).toBe(true);
    await app.close();
  });

  it("backfills normalized Topics idempotently and preserves creation order", () => {
    const first = repository.saveItem({ language: "en", cue: "Первый", target: "First.", tags: [" My Topic "] });
    const second = repository.saveItem({ language: "en", cue: "Второй", target: "Second.", tags: ["my   topic"] });
    repository.backfillTopicsFromTags("en");
    repository.backfillTopicsFromTags("en");

    const matching = repository.listIslands("en").filter((island) => island.title.toLocaleLowerCase().includes("my topic"));
    expect(matching).toHaveLength(1);
    expect(repository.getIsland(matching[0].publicId)?.items.map((item) => item.publicId))
      .toEqual([first.publicId, second.publicId]);
  });

  it("does not recreate a deleted backfilled Topic after restart", async () => {
    repository.saveItem({ language: "en", cue: "Удалить тему", target: "Delete the topic.", tags: ["Temporary tag topic"] });
    const app = await buildApp(repository);
    const topic = repository.findIslandByTitle("en", "Temporary tag topic")!;
    expect(topic).not.toBeNull();
    expect((await app.inject({ method: "DELETE", url: `/api/islands/${topic.publicId}` })).statusCode).toBe(204);
    await app.close();

    const restarted = await buildApp(repository);
    expect(repository.findIslandByTitle("en", "Temporary tag topic")).toBeNull();
    await restarted.close();
  });

  it("supports Topic CRUD, membership ordering, and deletion without deleting cards", async () => {
    const first = repository.saveItem({ language: "en", cue: "А", target: "A.", tags: [] });
    const second = repository.saveItem({ language: "en", cue: "Б", target: "B.", tags: [] });
    repository.recordAttempt({
      itemPublicId: first.publicId, mode: "recall", answer: "A.", score: 1, verdict: "easy", feedback: {}, rating: "easy",
    });
    const app = await buildApp(repository);
    const created = await app.inject({
      method: "POST", url: "/api/islands",
      payload: { language: "en", title: "Manual topic", itemIds: [second.publicId, first.publicId] },
    });
    expect(created.statusCode).toBe(201);
    const islandId = created.json().island.publicId as string;

    const detail = await app.inject({ method: "GET", url: `/api/islands/${islandId}` });
    expect(detail.json().island.items.map((item: { publicId: string }) => item.publicId))
      .toEqual([second.publicId, first.publicId]);

    const updated = await app.inject({
      method: "PATCH", url: `/api/islands/${islandId}`,
      payload: { title: "Renamed topic", itemIds: [first.publicId] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().island).toMatchObject({ title: "Renamed topic", itemCount: 1 });

    const removed = await app.inject({ method: "DELETE", url: `/api/islands/${islandId}` });
    expect(removed.statusCode).toBe(204);
    expect(repository.getItem(first.publicId)).not.toBeNull();
    expect(repository.getItem(second.publicId)).not.toBeNull();
    expect(repository.listDueItems("en", 500).some((item) => item.publicId === first.publicId)).toBe(false);
    await app.close();

    const restarted = await buildApp(repository);
    expect(repository.findIslandByTitle("en", "Renamed topic")).toBeNull();
    await restarted.close();
  });

  it("caps fresh cards without hiding scheduled reviews", () => {
    expect(repository.listDueItems("en", 100, new Date(), 3)
      .filter((item) => item.schedule.state === "new")).toHaveLength(3);
  });
});
