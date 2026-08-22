import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { ReviewCandidate } from "../types.js";
import { aiLimits } from "./ai-limits.js";
import type { LearnerPersona } from "./learner-persona.js";
import { generatedMaterialSchema, materialInstructions, toCandidate } from "./material-generation.js";

type CandidateDraft = Pick<ReviewCandidate, "target" | "cue" | "note" | "category">;

export async function reviseReviewCandidate(input: {
  client: OpenAI | null;
  repository: Pick<RehearsalRepository, "reviews">;
  learner: LearnerPersona;
  batchPublicId: string;
  candidateId: string;
  instruction: "another" | "different_context" | "feedback";
  feedback?: string;
  draft?: CandidateDraft;
}) {
  const batch = input.repository.reviews.get(input.batchPublicId);
  const original = batch?.candidates.find((candidate) => candidate.id === input.candidateId);
  if (!batch || !original) return null;
  if (!input.client) throw new Error("OPENAI_NOT_CONFIGURED");
  const task = input.instruction === "different_context"
    ? "Replace the candidate with one natural example using the same focus term in a clearly different relevant context. Return exactly one item."
    : input.instruction === "feedback"
      ? "Revise only this candidate using the supplied learner feedback. Preserve the intended meaning and return exactly one item."
      : "Replace the candidate with a better natural personal version that keeps the intended focus and meaning. Return exactly one item.";
  const response = await input.client.responses.parse({
    model: config.balancedModel,
    reasoning: { effort: "low" },
    instructions: materialInstructions(input.learner, batch.language, task),
    input: JSON.stringify({
      batchTitle: batch.title,
      original: { ...original, ...input.draft },
      feedback: input.feedback?.trim() || undefined,
    }),
    text: { format: zodTextFormat(generatedMaterialSchema, "replacement_candidate") },
    max_output_tokens: aiLimits.utilityOutputTokens,
  });
  const generated = response.output_parsed?.items[0];
  if (!generated || response.output_parsed?.items.length !== 1) {
    throw new Error("INCOMPLETE_CANDIDATE_REVISION");
  }
  return input.repository.reviews.replaceCandidate(batch.publicId, original.id, {
    ...toCandidate(generated), id: original.id,
  });
}
