import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

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
});
