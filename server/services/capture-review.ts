import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode, ReviewCandidate } from "../types.js";
import { aiLimits, assertAiSourceWithinBudget } from "./ai-limits.js";
import type { LearnerPersona } from "./learner-persona.js";
import { generatedCandidateSchema, materialInstructions, toCandidate } from "./material-generation.js";

const commentedRevisionSchema = z.object({
  items: z.array(generatedCandidateSchema.extend({ candidateId: z.string().uuid() })).max(100),
});

type CandidateSelection = Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">;

export async function resolveCaptureReview({ client, input, repository, learner, verifyCandidates }: {
  client: OpenAI | null;
  input: {
    batchPublicId: string;
    accepted: CandidateSelection[];
    revisions: Array<CandidateSelection & { feedback: string }>;
  };
  repository: Pick<RehearsalRepository, "reviews">;
  learner: LearnerPersona;
  verifyCandidates: (candidates: ReviewCandidate[], language: LanguageCode) => Promise<ReviewCandidate[]>;
}) {
  const batch = repository.reviews.get(input.batchPublicId);
  if (!batch || batch.kind !== "capture" || batch.status !== "draft") return null;
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
    const response = await client.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        learner,
        batch.language,
        "Revise only the supplied candidates using each candidate's own Russian feedback. " +
          "Return exactly one replacement for every supplied candidateId, preserve that candidateId, " +
          "do not return accepted or unrelated cards, and keep the intended personal meaning.",
      ),
      input: JSON.stringify({
        title: batch.title,
        source: assertAiSourceWithinBudget(batch.sourceText),
        candidates: currentCandidates,
      }),
      text: { format: zodTextFormat(commentedRevisionSchema, "commented_candidate_revisions") },
      max_output_tokens: aiLimits.batchOutputTokens,
    });
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
  return repository.reviews.resolveCaptureRevision(batch.publicId, input.accepted, revisedCandidates);
}
