import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { reviewCandidate } from "../testing/candidates.js";

describe("Tutor and review API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("remains a usable setup guide before an OpenAI key is configured", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(context.repository, { openai });
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { language: "en", message: "Help me practice small talk" },
    });
    expect(response.json()).toMatchObject({ mode: "setup" });
    const threadId = response.json().threadId as string;
    const threads = await app.inject({ method: "GET", url: "/api/chat/threads?language=en" });
    expect(threads.json().threads).toEqual([
      expect.objectContaining({ publicId: threadId, title: "Help me practice small talk", messageCount: 2 }),
    ]);
    const history = await app.inject({ method: "GET", url: `/api/chat/${threadId}/messages` });
    expect(history.json().messages[0]).toEqual({ role: "user", content: "Help me practice small talk" });
    expect((await app.inject({ method: "DELETE", url: `/api/chat/${threadId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/chat/threads?language=en" })).json().threads).toEqual([]);
    await app.close();
  });

  it("keeps generated proposals out of Library until selected cards are committed", async () => {
    const before = context.repository.items.list("en", 500).length;
    const candidate = reviewCandidate({
      target: "I tend to bounce back pretty quickly.",
      cue: "Я обычно довольно быстро прихожу в себя.",
      category: "resilience",
      focusTerms: ["bounce back"],
    });
    const batch = context.repository.reviews.create({
      language: "en",
      kind: "vocab",
      title: "Vocab test",
      candidates: [candidate],
    });
    expect(context.repository.items.list("en", 500)).toHaveLength(before);

    const app = await buildApp(context.repository);
    const response = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batch.publicId}/commit`,
      payload: { candidates: [{
        id: candidate.id,
        target: candidate.target,
        cue: candidate.cue,
        note: candidate.note,
        category: candidate.category,
      }] },
    });
    expect(response.json().added).toBe(1);
    expect(context.repository.items.list("en", 500)).toHaveLength(before + 1);
    expect(context.repository.items.list("en", 500).find((item) => item.target === candidate.target))
      .toMatchObject({ frequencyBand: "common", currency: "current", focusTerms: ["bounce back"] });
    await app.close();
  });

  it("commits only the selected pattern-drill variants", async () => {
    const before = context.repository.items.list("en", 500).length;
    const first = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb521",
      target: "I've always been drawn to quiet coastal towns.",
      cue: "Меня всегда тянуло к тихим приморским городам.",
      category: "travel",
      focusTerms: ["be drawn to"],
    });
    const second = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb522",
      target: "I've always been drawn to people who speak their mind.",
      cue: "Меня всегда тянуло к людям, которые говорят прямо.",
      category: "relationships",
      focusTerms: ["be drawn to"],
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "generatePatternDrill").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "pattern_drill",
        title: "Pattern: I've always been drawn to…",
        candidates: [first, second],
      }),
    }));
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({ method: "POST", url: "/api/items/en-drawn-to/pattern-drill" });
    expect(prepared.statusCode).toBe(201);
    expect(context.repository.items.list("en", 500)).toHaveLength(before);

    const selected = prepared.json().batch.candidates[1];
    expect((await app.inject({
      method: "POST",
      url: `/api/review-batches/${prepared.json().batch.publicId}/commit`,
      payload: { candidates: [{
        id: selected.id,
        target: selected.target,
        cue: selected.cue,
        note: selected.note,
        category: selected.category,
      }] },
    })).json().added).toBe(1);
    const after = context.repository.items.list("en", 500);
    expect(after).toHaveLength(before + 1);
    expect(after.some((item) => item.target === first.target)).toBe(false);
    expect(after.find((item) => item.target === second.target)?.tags).toEqual(["be drawn to"]);
    await app.close();
  });
});
