import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode, ReviewCandidate } from "../types.js";
import { aiLimits, assertAiSourceWithinBudget } from "./ai-limits.js";
import { responseTokenUsage, trackAiRequest } from "./ai-usage.js";
import type { LearnerPersona } from "./learner-persona.js";
import { generatedCandidateSchema, materialInstructions, toCandidate } from "./material-generation.js";

const commentedRevisionSchema = z.object({
  items: z.array(generatedCandidateSchema.extend({ candidateId: z.string().uuid() })).max(100),
});

type CandidateSelection = Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">;
type ReviewResolutionDependencies = {
  client: OpenAI | null;
  input: {
    batchPublicId: string;
    accepted: CandidateSelection[];
    revisions: Array<CandidateSelection & { feedback: string }>;
  };
  repository: Pick<RehearsalRepository, "aiUsage" | "reviews">;
  learner: LearnerPersona;
  verifyCandidates: (candidates: ReviewCandidate[], language: LanguageCode) => Promise<ReviewCandidate[]>;
};

async function resolveReview(
  { client, input, repository, learner, verifyCandidates }: ReviewResolutionDependencies,
  captureOnly: boolean,
) {
  const batch = repository.reviews.get(input.batchPublicId);
  if (!batch || (captureOnly && batch.kind !== "capture") || batch.status !== "draft") return null;
  const candidates = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
  const acceptedIds = new Set(input.accepted.map((candidate) => candidate.id));
  if (input.accepted.some((candidate) => !candidates.has(candidate.id)) ||
    input.revisions.some((candidate) => acceptedIds.has(candidate.id) || !candidates.has(candidate.id))) {
    throw new Error("INVALID_CAPTURE_REVISION");
  }
  let revisedCandidates: ReviewCandidate[] = [];
  if (input.revisions.length) {
    if (!client) throw new Error("OPENAI_NOT_CONFIGURED");
    const currentCandidates = input.revisions.map((edited) => ({
      ...candidates.get(edited.id)!,
      target: edited.target.trim(),
      cue: edited.cue.trim(),
      note: edited.note.trim(),
      category: edited.category.trim(),
      feedback: edited.feedback.trim(),
    }));
    const requestInput = JSON.stringify({
      title: batch.title,
      source: assertAiSourceWithinBudget(batch.sourceText),
      candidates: currentCandidates,
    });
    const response = await trackAiRequest({
      repository: repository.aiUsage, provider: "openai", workload: "review_resolution",
      language: batch.language, model: config.balancedModel,
      inputCharacters: requestInput.length, measure: responseTokenUsage,
    }, () => client.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        learner,
        batch.language,
        "Revise only the supplied candidates using each candidate's own feedback. " +
          "Return exactly one replacement for every supplied candidateId, preserve that candidateId, " +
          "do not return accepted or unrelated cards, and keep the intended personal meaning.",
      ),
      input: requestInput,
      text: { format: zodTextFormat(commentedRevisionSchema, "commented_candidate_revisions") },
      max_output_tokens: aiLimits.batchOutputTokens,
    }));
    const generated = response.output_parsed?.items || [];
    const expectedIds = new Set(input.revisions.map((candidate) => candidate.id));
    const generatedIds = new Set(generated.map((candidate) => candidate.candidateId));
    if (generated.length !== expectedIds.size || generatedIds.size !== expectedIds.size ||
      generated.some((candidate) => !expectedIds.has(candidate.candidateId))) {
      throw new Error("INCOMPLETE_CAPTURE_REVISION");
    }
    revisedCandidates = generated.map((candidate) => {
      const { candidateId, ...replacement } = candidate;
      return { ...toCandidate(replacement), id: candidateId };
    });
    revisedCandidates = await verifyCandidates(revisedCandidates, batch.language);
  }
  return repository.reviews.resolveRevision(batch.publicId, input.accepted, revisedCandidates);
}

export const resolveCaptureReview = (dependencies: ReviewResolutionDependencies) => resolveReview(dependencies, true);
export const resolveReviewBatch = (dependencies: ReviewResolutionDependencies) => resolveReview(dependencies, false);
