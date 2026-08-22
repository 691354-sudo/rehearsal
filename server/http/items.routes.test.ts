import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { reviewCandidate } from "../testing/candidates.js";

describe("Item API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("allows the client to request a Library larger than 500 cards", async () => {
    const app = await buildApp(context.repository);
    const response = await app.inject({ method: "GET", url: "/api/items?language=en&limit=2000" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns an edited proposal without changing the saved Library card", async () => {
    const original = context.repository.items.get("en-drawn-to")!;
    const openai = new OpenAIService(context.repository);
    const rewrite = vi.spyOn(openai, "rewriteLibraryItem").mockResolvedValue({
      target: "I've always liked quiet coastal towns.",
      cue: "Мне всегда нравились тихие приморские города.",
      note: "Casual alternative.",
    });
    const app = await buildApp(context.repository, { openai });

    const response = await app.inject({
      method: "POST",
      url: `/api/items/${original.publicId}/rewrite`,
      payload: {
        target: original.target,
        cue: original.cue,
        note: original.note,
        feedback: "Слишком формально. Сохрани контекст, но сделай разговорнее.",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ proposal: {
      target: "I've always liked quiet coastal towns.",
      cue: "Мне всегда нравились тихие приморские города.",
      note: "Casual alternative.",
    } });
    expect(rewrite).toHaveBeenCalledWith(expect.objectContaining({
      language: "en",
      target: original.target,
      cue: original.cue,
      feedback: "Слишком формально. Сохрани контекст, но сделай разговорнее.",
    }));
    expect(context.repository.items.get(original.publicId)).toEqual(original);
    await app.close();
  });

  it("does not call the model for an unknown card", async () => {
    const openai = new OpenAIService(context.repository);
    const rewrite = vi.spyOn(openai, "rewriteLibraryItem");
    const app = await buildApp(context.repository, { openai });
    const response = await app.inject({
      method: "POST",
      url: "/api/items/missing-card/rewrite",
      payload: { target: "Anything", cue: "Что угодно", note: "", feedback: "Make it casual." },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "ITEM_NOT_FOUND" });
    expect(rewrite).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns an unavailable response without changing the card", async () => {
    const original = context.repository.items.get("en-drawn-to")!;
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "rewriteLibraryItem").mockRejectedValue(new Error("OPENAI_NOT_CONFIGURED"));
    const app = await buildApp(context.repository, { openai });
    const response = await app.inject({
      method: "POST",
      url: `/api/items/${original.publicId}/rewrite`,
      payload: {
        target: original.target,
        cue: original.cue,
        note: original.note,
        feedback: "Make it sound more casual.",
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "OPENAI_NOT_CONFIGURED" });
    expect(context.repository.items.get(original.publicId)).toEqual(original);
    await app.close();
  });

  it("stores and searches Vietnamese target text in NFC", async () => {
    context.repository.system.setLanguageEnabled("vi", true);
    const app = await buildApp(context.repository);
    const target = "Tôi muốn uống cà phê.";
    const created = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: { language: "vi", cue: "Я хочу выпить кофе.", target: target.normalize("NFD") },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().item.target).toBe(target);

    const saved = context.repository.items.save({
      language: "vi",
      cue: "Привет.",
      target: "Xin chào".normalize("NFD"),
      acceptedAnswers: ["Chào bạn".normalize("NFD")],
    });
    expect(saved.target).toBe("Xin chào");
    expect(saved.acceptedAnswers).toEqual(["Chào bạn"]);

    const search = await app.inject({
      method: "GET",
      url: `/api/search?language=vi&q=${encodeURIComponent("cà phê".normalize("NFD"))}`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.map((item: { target: string }) => item.target)).toContain(target);
    await app.close();
  });

  it("creates a manual card inside a Topic atomically", async () => {
    const topic = context.repository.library.createIsland({ language: "en", title: "Manual cards" });
    const app = await buildApp(context.repository);
    const before = context.repository.items.list("en", 2_000).length;
    const created = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: {
        language: "en",
        target: "I can pull through.",
        cue: "Я смогу справиться.",
        focusTerms: ["pull through"],
        topicId: topic.publicId,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(context.repository.library.getIsland(topic.publicId)?.items.map((item) => item.publicId))
      .toContain(created.json().item.publicId);

    const missing = await app.inject({
      method: "POST",
      url: "/api/items",
      payload: {
        language: "en",
        target: "This must not be saved.",
        cue: "Это не должно сохраниться.",
        topicId: "ad9bdcb8-3094-43cd-8e75-92ed741bb501",
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(context.repository.items.list("en", 2_000)).toHaveLength(before + 1);
    await app.close();
  });

  it("routes $ imports strictly and commits selected fragments to one Topic", async () => {
    const openai = new OpenAIService(context.repository);
    const first = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb571",
      target: "First original line.",
      cue: "Первая исходная строка.",
      category: "ignored category",
      focusTerms: [],
    });
    const second = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb572",
      target: "Second original line.",
      cue: "Вторая исходная строка.",
      category: "another category",
      focusTerms: [],
    });
    const strict = vi.spyOn(openai, "prepareDelimitedImportedMaterial").mockImplementation(async (input) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language: input.language,
        kind: "text_import",
        title: input.title,
        sourceText: input.text,
        destinationTopicTitle: input.title,
        candidates: [first, second],
      }),
    }));
    const ordinary = vi.spyOn(openai, "prepareImportedMaterial").mockImplementation(async (input) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language: input.language, kind: "text_import", title: input.title, candidates: [],
      }),
    }));
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({
      method: "POST",
      url: "/api/import/text",
      payload: { language: "en", title: "Interview discipline", text: "First original line. $ Second original line." },
    });
    expect(prepared.statusCode).toBe(201);
    expect(strict).toHaveBeenCalledOnce();
    expect(ordinary).not.toHaveBeenCalled();
    expect(prepared.json().batch).toMatchObject({ destinationTopicTitle: "Interview discipline" });
    expect(context.repository.library.findIslandByTitle("en", "Interview discipline")).toBeNull();

    const committed = await app.inject({
      method: "POST",
      url: `/api/review-batches/${prepared.json().batch.publicId}/commit`,
      payload: { candidates: [first, second].map(({ id, target, cue, note, category }) => ({ id, target, cue, note, category })) },
    });
    expect(committed.json().added).toBe(2);
    const topic = context.repository.library.findIslandByTitle("en", "Interview discipline")!;
    expect(context.repository.library.getIsland(topic.publicId)?.items.map((item) => item.target))
      .toEqual([first.target, second.target]);

    await app.inject({
      method: "POST", url: "/api/import/text",
      payload: { language: "en", title: "Ordinary", text: "One sentence without a delimiter." },
    });
    expect(ordinary).toHaveBeenCalledOnce();
    const oversizedOrdinary = await app.inject({
      method: "POST", url: "/api/import/text",
      payload: { language: "en", title: "Too large", text: "a".repeat(50_001) },
    });
    expect(oversizedOrdinary.statusCode).toBe(400);
    expect(ordinary).toHaveBeenCalledOnce();
    await app.close();
  });
});
