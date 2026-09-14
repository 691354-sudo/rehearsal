import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { reviewCandidate } from "../testing/candidates.js";
import { OpenAIService } from "./openai.js";

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
vi.mock("../config.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../config.js")>(), openAIConfigured: true,
}));

describe("Tutor category preparation through Review", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); parse.mockReset(); });
  afterEach(() => { context.close(); vi.restoreAllMocks(); });

  it("supplies the active language catalog and saves the proposed category with Topic and Core", async () => {
    const repo = context.repository;
    const category = repo.categories.create({ language: "en", title: "Conversational phrases" });
    repo.categories.create({ language: "vi", title: "Vietnamese phrases" });
    parse.mockResolvedValue({ output_parsed: { items: [reviewCandidate({ learningCategoryIds: [category.publicId] })] } });
    const result = await new OpenAIService(repo).reviewConversation({ language: "en", threadPublicId: randomUUID(),
      messages: [{ role: "user", content: "Make a card for asking someone to give me a moment." }] });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(JSON.parse(parse.mock.calls[0][0].input).learningCategoryCatalog).toEqual(repo.categories.catalog("en"));
    expect(parse.mock.calls[0][0].instructions).toContain("even when the learner only asks to make cards");
    expect(parse.mock.calls[0][0].instructions).toContain("An empty catalog is not a reason");
    expect(repo.categories.get(category.publicId)?.items).toHaveLength(0);
    const committed = repo.reviews.commit(result.batch.publicId, result.batch.candidates)!.items[0];
    expect(committed).toMatchObject({ focusTerms: ["give me a moment"], learningCategoryIds: [category.publicId] });
    expect(committed.topicId).toBe(repo.library.findIslandByTitle("en", "conversation")?.publicId);
  });

  it("proposes number categories locally, preserves every pair and creates one category only on commit", async () => {
    const repo = context.repository;
    repo.categories.create({ language: "en", title: "Numbers and quantities" });
    const service = new OpenAIService(repo);
    const request = { publicId: randomUUID(), language: "vi" as const, threadPublicId: randomUUID(),
      messages: [{ role: "user" as const, content: "Сделай карточки для чисел 0–3." },
        { role: "assistant" as const, content: "0 — không\n1 — một\n2 — hai\n3 — ba" }] };
    const { batch } = await service.reviewConversation(request);
    expect(parse).not.toHaveBeenCalled();
    expect(batch.candidates.map(({ cue, target }) => [cue, target])).toEqual([
      ["0", "không"], ["1", "một"], ["2", "hai"], ["3", "ba"],
    ]);
    expect(repo.categories.catalog("vi")).toEqual([]);
    expect(new Set(batch.candidates.map((card) => card.newLearningCategories![0].publicId)).size).toBe(1);
    expect((await service.reviewConversation(request)).batch.candidates).toEqual(batch.candidates);
    const committed = repo.reviews.commit(batch.publicId, batch.candidates)!.items;
    expect(repo.categories.catalog("vi")).toHaveLength(1);
    const category = repo.categories.catalog("vi")[0];
    expect(category.title).toBe("Numbers and quantities");
    expect(committed).toHaveLength(4);
    for (const card of committed) expect(card.learningCategoryIds).toEqual([category.publicId]);
    expect(repo.categories.get(category.publicId)?.items).toHaveLength(4);
  });

  it("keeps a generated category for an empty catalog as a draft until the card is approved", async () => {
    const repo = context.repository;
    parse.mockResolvedValue({ output_parsed: { items: [{
      ...reviewCandidate({ target: "Chào chị!", cue: "Здравствуйте! — женщине старше вас.", category: "Introductions", focusTerms: ["chị"] }),
      newLearningCategories: [{ title: "Forms of address", description: "Choose an appropriate respectful form of address." }],
    }] } });
    const { batch } = await new OpenAIService(repo).reviewConversation({ language: "vi", threadPublicId: randomUUID(),
      messages: [{ role: "user", content: "Сделай карточку для приветствия старшей женщины." }] });
    expect(JSON.parse(parse.mock.calls[0][0].input).learningCategoryCatalog).toEqual([]);
    expect(repo.categories.catalog("vi")).toEqual([]);
    expect(batch.candidates[0].newLearningCategories?.[0]).toMatchObject({ publicId: expect.any(String), title: "Forms of address" });
    const item = repo.reviews.commit(batch.publicId, batch.candidates)!.items[0];
    expect(item.learningCategoryIds).toEqual([repo.categories.catalog("vi")[0].publicId]);
    expect(item.topicId).toBe(repo.library.findIslandByTitle("vi", "Introductions")?.publicId);
  });

  it("reuses an existing number category and respects removing it in Review", async () => {
    const repo = context.repository;
    const category = repo.categories.create({ language: "lv", title: "Numbers" });
    const { batch } = await new OpenAIService(repo).reviewConversation({ language: "lv", threadPublicId: randomUUID(),
      messages: [{ role: "user", content: "Make cards for numbers 1 and 2." },
        { role: "assistant", content: "1 — viens\n2 — divi" }] });
    expect(parse).not.toHaveBeenCalled();
    for (const candidate of batch.candidates) {
      expect(candidate.learningCategoryIds).toEqual([category.publicId]);
      expect(candidate.newLearningCategories).toEqual([]);
    }
    const committed = repo.reviews.commit(batch.publicId,
      batch.candidates.map((card) => ({ ...card, learningCategoryIds: [], newLearningCategories: [] })))!.items;
    for (const card of committed) expect(card.learningCategoryIds).toEqual([]);
    expect(repo.categories.get(category.publicId)?.items).toHaveLength(0);
  });
});
