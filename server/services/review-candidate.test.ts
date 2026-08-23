import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import type { RehearsalRepository } from "../db/repository.js";
import { reviewCandidate } from "../testing/candidates.js";
import { reviseReviewCandidate } from "./review-candidate.js";

describe("review candidate revision", () => {
  it("restores required fields from the stored candidate when a client draft sends them empty", async () => {
    const original = reviewCandidate();
    const generated = { ...original };
    const { id: _id, ...replacement } = generated;
    const parse = vi.fn().mockResolvedValue({ output_parsed: { items: [replacement] } });
    const replaceCandidate = vi.fn().mockReturnValue({ publicId: "batch-id" });
    const repository = {
      reviews: {
        get: vi.fn().mockReturnValue({
          publicId: "batch-id",
          language: "en",
          title: "Capture Reality",
          candidates: [original],
        }),
        replaceCandidate,
      },
    } as unknown as Pick<RehearsalRepository, "reviews">;

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
