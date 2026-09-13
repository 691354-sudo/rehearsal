import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { LanguageCode, ReviewCandidate } from "../../contracts/api.js";
import type { RehearsalRepository } from "../db/repository.js";
import { config } from "../config.js";
import { aiLimits, assertAiSourceWithinBudget } from "./ai-limits.js";
import { responseTokenUsage, trackAiRequest } from "./ai-usage.js";
import type { LearnerPersona } from "./learner-persona.js";
import { generatedCandidateSchema, materialInstructions, toCandidate } from "./material-generation.js";
import { preserveCandidateCategories } from "./learning-categories.js";

export async function reviseReviewBatch({ input, client, repository, learner, verifyCandidates }: {
  input: { batchPublicId: string; feedback: string };
  client: OpenAI | null;
  repository: Pick<RehearsalRepository, "aiUsage" | "categories" | "reviews">;
  learner: LearnerPersona;
  verifyCandidates: (candidates: ReviewCandidate[], language: LanguageCode) => Promise<ReviewCandidate[]>;
}) {
    const batch = repository.reviews.get(input.batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    if (!client) throw new Error("OPENAI_NOT_CONFIGURED");
    const requestInput = JSON.stringify({
      title: batch.title,
      source: assertAiSourceWithinBudget(batch.sourceText),
      learningCategoryCatalog: repository.categories.catalog(batch.language),
      currentCandidates: batch.candidates.map((candidate, index) => ({ number: index + 1, ...candidate })),
      feedback: input.feedback.trim(),
    });
    const response = await trackAiRequest({
      repository: repository.aiUsage, provider: "openai", workload: "batch_revision",
      language: batch.language, model: config.balancedModel,
      inputCharacters: requestInput.length, measure: responseTokenUsage,
    }, () => client!.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        learner,
        batch.language,
        "Revise the complete proposal batch using the user's Russian feedback. " +
          "Numbers in the feedback refer to the current one-based candidate order. " +
          "Keep good candidates, rewrite the requested ones, remove rejected ones, and do not add unrelated material. " +
          "Return the complete revised batch, not only changed items. Set candidateId to the original candidate id for every retained or rewritten card, and null only for a new card.",
      ),
      input: requestInput,
      text: { format: zodTextFormat(z.object({ items: z.array(generatedCandidateSchema.extend({ candidateId: z.string().uuid().nullable() })).max(100) }), "revised_learning_candidates") },
      max_output_tokens: aiLimits.batchOutputTokens,
    }));
    if (!response.output_parsed) throw new Error("The tutor did not return revised material");
    const candidates = await verifyCandidates(
      response.output_parsed.items.slice(0, 100).map((generated) => {
        const current = batch.candidates.find((candidate) => candidate.id === generated.candidateId
          || (!generated.candidateId && candidate.target === generated.target));
        const candidate = toCandidate(generated);
        return current ? { ...preserveCandidateCategories(candidate, current), id: current.id } : candidate;
      }),
      batch.language,
    );
    return repository.reviews.replaceCandidates(batch.publicId, candidates, input.feedback);
}
