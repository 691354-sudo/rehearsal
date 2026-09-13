import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import type { RehearsalRepository } from "../db/repository.js";
import { reviewCandidate } from "../testing/candidates.js";
import { reviseReviewCandidate } from "./review-candidate.js";

describe("review candidate revision", () => {
  it("preserves manual categories, including an explicit empty selection, when AI rewrites the Core", async () => {
    const original = reviewCandidate({ learningCategoryIds: ["d7daf820-eeb0-47dd-9602-edb40e7d99df"] });
    const replacement = { ...original, focusTerms: ["moment"], learningCategoryIds: ["b678320d-50cd-47e4-a1d7-b7ca3cb6ccf0"],
      newLearningCategories: [{ title: "Unexpected category", description: "Must not be applied" }] };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { items: [replacement] } });
    const replaceCandidate = vi.fn();
    const repository = { aiUsage: { record: vi.fn() }, categories: { catalog: () => [] },
      reviews: { get: () => ({ publicId: "batch", language: "en", title: "Review", candidates: [original] }), replaceCandidate } } as unknown as Pick<RehearsalRepository, "aiUsage" | "reviews" | "categories">;
    const input = { client: { responses: { parse } } as unknown as OpenAI, repository,
      learner: { name: "Learner", context: "Adult" }, batchPublicId: "batch", candidateId: original.id, instruction: "feedback" as const };
    await reviseReviewCandidate(input);
    expect(replaceCandidate.mock.calls[0][2]).toMatchObject({ learningCategoryIds: original.learningCategoryIds, newLearningCategories: [], focusTerms: ["moment"] });
    await reviseReviewCandidate({ ...input, draft: { learningCategoryIds: [], newLearningCategories: [] } });
    expect(replaceCandidate.mock.calls[1][2]).toMatchObject({ learningCategoryIds: [], newLearningCategories: [] });
  });

  it("restores required fields from the stored candidate when a client draft sends them empty", async () => {
    const original = reviewCandidate();
    const generated = { ...original };
    const { id: _id, ...replacement } = generated;
    const parse = vi.fn().mockResolvedValue({ output_parsed: { items: [replacement] } });
    const replaceCandidate = vi.fn().mockReturnValue({ publicId: "batch-id" });
    const repository = {
      aiUsage: { record: vi.fn() },
      categories: { catalog: () => [] },
      reviews: {
        get: vi.fn().mockReturnValue({
          publicId: "batch-id",
          language: "en",
          title: "Capture Reality",
          candidates: [original],
        }),
        replaceCandidate,
      },
    } as unknown as Pick<RehearsalRepository, "aiUsage" | "reviews" | "categories">;

    await reviseReviewCandidate({
      client: { responses: { parse } } as unknown as OpenAI,
      repository,
      learner: { name: "Roman", context: "A Russian-speaking adult." },
      batchPublicId: "batch-id",
      candidateId: original.id,
      instruction: "feedback",
      feedback: "Make it more natural.",
      draft: { target: "", cue: "", note: original.note, category: original.category },
    });

    const request = parse.mock.calls[0][0] as { input: string };
    expect(JSON.parse(request.input).original).toMatchObject({
      target: original.target,
      cue: original.cue,
    });
    expect(replaceCandidate).toHaveBeenCalledWith("batch-id", original.id, expect.objectContaining({ id: original.id }));
  });
});
