import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { reviewCandidate } from "../testing/candidates.js";

describe("Capture review API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("prepares oldest notes, revises the batch, and commits it atomically", async () => {
    const first = context.repository.capture.createText({
      language: "en",
      transcript: "Я хотел попросить клиента немного подождать.",
    });
    const second = context.repository.capture.create({
      language: "en",
      audio: Buffer.from("two"),
      audioMime: "audio/webm",
    });
    context.repository.capture.completeTranscription(
      second.publicId,
      "Я хотел объяснить, что срок изменился.",
    );
    const candidate = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb511",
      target: "Could you wait a moment?",
      cue: "Можешь немного подождать?",
      category: "Client work",
      focusTerms: ["wait a moment"],
      frequencyBand: "core",
    });
    const openai = new OpenAIService(context.repository);
    const prepare = vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [candidate],
      }),
    }));
    vi.spyOn(openai, "reviseReviewBatch").mockImplementation(async ({ batchPublicId, feedback }) => {
      const batch = context.repository.reviews.get(batchPublicId)!;
      return context.repository.reviews.replaceCandidates(batchPublicId, [{
        ...batch.candidates[0],
        target: "Could you give me a moment?",
      }], feedback);
    });
    const app = await buildApp(context.repository, { openai });

    const prepared = await app.inject({
      method: "POST",
      url: "/api/captures/process",
      payload: { language: "en" },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepare.mock.calls[0][0].notes.map((note) => note.transcript)).toEqual([
      "Я хотел попросить клиента немного подождать.",
      "Я хотел объяснить, что срок изменился.",
    ]);
    const batchId = prepared.json().batch.publicId as string;
    expect(context.repository.capture.list("en").every((note) => note.status === "batched")).toBe(true);

    const revised = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/revise`,
      payload: { feedback: "Первая фраза слишком формальная." },
    });
    expect(revised.json().batch.candidates[0].target).toBe("Could you give me a moment?");
    const selected = revised.json().batch.candidates[0];
    const committed = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/commit`,
      payload: { candidates: [{
        id: selected.id,
        target: selected.target,
        cue: selected.cue,
        note: selected.note,
        category: selected.category,
      }] },
    });
    expect(committed.json().added).toBe(1);
    expect(context.repository.capture.list("en", true).filter((note) =>
      [first.publicId, second.publicId].includes(note.publicId)
    ).every((note) => note.status === "processed")).toBe(true);
    expect(context.repository.items.list("en", 500).find((item) => item.target === selected.target)?.tags)
      .toEqual(["wait a moment"]);
    const topic = context.repository.library.findIslandByTitle("en", "Client work");
    expect(context.repository.library.getIsland(topic!.publicId)?.items.map((item) => item.target))
      .toContain(selected.target);
    await app.close();
  });

  it("saves accepted cards while keeping commented cards in review", async () => {
    const first = context.repository.capture.createText({ language: "en", transcript: "Я хочу заказать кофе." });
    const second = context.repository.capture.createText({
      language: "en",
      transcript: "Я хочу попросить овсяное молоко.",
    });
    const approved = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb541",
      target: "I'd like a coffee.",
      cue: "Я хочу заказать кофе.",
      category: "café",
      focusTerms: ["I'd like"],
      frequencyBand: "core",
    });
    const commented = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb542",
      target: "Could I get oat milk?",
      cue: "Можно мне овсяное молоко?",
      category: "café",
      focusTerms: ["Could I get"],
      frequencyBand: "core",
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [approved, commented],
      }),
    }));
    vi.spyOn(openai, "resolveCaptureReview").mockImplementation(async ({ batchPublicId, accepted, revisions }) => {
      const batch = context.repository.reviews.get(batchPublicId)!;
      const revised = revisions.map((revision) => ({
        ...batch.candidates.find((candidate) => candidate.id === revision.id)!,
        target: "Could I have oat milk instead?",
      }));
      return context.repository.reviews.resolveCaptureRevision(batchPublicId, accepted, revised);
    });
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({
      method: "POST", url: "/api/captures/process", payload: { language: "en" },
    });
    const batchId = prepared.json().batch.publicId as string;
    const partial = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/resolve-capture`,
      payload: {
        accepted: [{
          id: approved.id,
          target: approved.target,
          cue: approved.cue,
          note: approved.note,
          category: approved.category,
        }],
        revisions: [{
          id: commented.id,
          target: commented.target,
          cue: commented.cue,
          note: commented.note,
          category: commented.category,
          feedback: "Скажи, что овсяное молоко нужно вместо обычного.",
        }],
      },
    });
    expect(partial.json()).toMatchObject({ added: 1, batch: { status: "draft" } });
    expect(partial.json().batch.candidates).toEqual([
      expect.objectContaining({ id: commented.id, target: "Could I have oat milk instead?" }),
    ]);
    expect(context.repository.items.list("en", 500).map((item) => item.target)).toContain(approved.target);
    expect(context.repository.capture.list("en", true).filter((note) =>
      [first.publicId, second.publicId].includes(note.publicId)
    ).every((note) => note.status === "batched")).toBe(true);

    const revised = partial.json().batch.candidates[0];
    const final = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batchId}/resolve-capture`,
      payload: {
        accepted: [{
          id: revised.id,
          target: revised.target,
          cue: revised.cue,
          note: revised.note,
          category: revised.category,
        }],
        revisions: [],
      },
    });
    expect(final.json()).toMatchObject({ added: 1, batch: { status: "committed", candidates: [] } });
    expect(context.repository.capture.list("en", true).filter((note) =>
      [first.publicId, second.publicId].includes(note.publicId)
    ).every((note) => note.status === "processed")).toBe(true);
    expect(context.repository.items.list("en", 500).map((item) => item.target))
      .toContain("Could I have oat milk instead?");
    await app.close();
  });

  it("resets generated cards and returns the original note to Notebook", async () => {
    const itemCount = context.repository.items.list("en", 500).length;
    const note = context.repository.capture.createText({
      language: "en",
      transcript: "Я хочу перенести встречу на завтра.",
    });
    const candidate = reviewCandidate({
      target: "Could we move the meeting to tomorrow?",
      cue: "Мы можем перенести встречу на завтра?",
      category: "work",
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [candidate],
      }),
    }));
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({
      method: "POST", url: "/api/captures/process", payload: { language: "en" },
    });
    const batchId = prepared.json().batch.publicId as string;

    const reset = await app.inject({
      method: "POST", url: `/api/review-batches/${batchId}/reset-capture`,
    });

    expect(reset.json()).toEqual({ reset: true, notes: 1 });
    expect(context.repository.reviews.get(batchId)).toBeNull();
    expect(context.repository.capture.get(note.publicId)).toMatchObject({
      status: "ready",
      reviewBatchPublicId: null,
      transcript: "Я хочу перенести встречу на завтра.",
    });
    expect(context.repository.items.list("en", 500)).toHaveLength(itemCount);
    await app.close();
  });

  it("completes the Notebook-to-Practice loop through Learned and reactivation", async () => {
    context.repository.capture.createText({ language: "en", transcript: "Здесь занято?" });
    const candidate = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb531",
      target: "Could we share this machine?",
      cue: "Мы можем вместе заниматься на этом тренажёре?",
      note: "At the gym",
      category: "gym",
      pattern: "Could we…?",
      focusTerms: ["share this machine"],
      frequencyBand: "core",
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [candidate],
      }),
    }));
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({
      method: "POST", url: "/api/captures/process", payload: { language: "en" },
    });
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
    const itemId = committed.json().items[0].publicId as string;
    const topic = context.repository.library.findIslandByTitle("en", "gym")!;
    expect(context.repository.library.getIsland(topic.publicId)?.items.map((item) => item.publicId))
      .toContain(itemId);

    const listened = await app.inject({
      method: "POST", url: "/api/reviews", payload: { itemId, mode: "shadow", rating: "good" },
    });
    expect(listened.json().review.schedule).toBeNull();
    const recalled = await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: { itemId, answer: candidate.target, mode: "recall", rating: "good" },
    });
    expect(recalled.json().attempt.schedule.dueAt).toBeTruthy();
    context.db.prepare(
      "UPDATE review_state SET due_at = '2000-01-01T00:00:00.000Z' WHERE item_id = (SELECT id FROM items WHERE public_id = ?)",
    ).run(itemId);

    expect((await app.inject({
      method: "PATCH", url: `/api/items/${itemId}`, payload: { practiceEnabled: false },
    })).json().item.practiceEnabled).toBe(false);
    expect(context.repository.practice.listDue("en", 100).some((item) => item.publicId === itemId)).toBe(false);
    await app.inject({
      method: "POST",
      url: "/api/attempts/evaluate",
      payload: { itemId, answer: candidate.target, mode: "recall", rating: "easy" },
    });
    expect(context.repository.items.get(itemId)?.practiceEnabled).toBe(false);
    context.db.prepare(
      "UPDATE review_state SET due_at = '2000-01-01T00:00:00.000Z' WHERE item_id = (SELECT id FROM items WHERE public_id = ?)",
    ).run(itemId);
    expect((await app.inject({
      method: "PATCH", url: `/api/items/${itemId}`, payload: { practiceEnabled: true },
    })).json().item.practiceEnabled).toBe(true);
    expect(context.repository.practice.listDue("en", 100).some((item) => item.publicId === itemId)).toBe(true);
    await app.close();
  });
});
