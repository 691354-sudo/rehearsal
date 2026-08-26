import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { focusTermsInTarget } from "../../contracts/text.js";
import { normalizeNfc } from "../../contracts/text.js";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode, ReviewCandidate } from "../types.js";
import { aiLimits } from "./ai-limits.js";
import { responseTokenUsage, trackAiRequest } from "./ai-usage.js";
import type { LearnerPersona } from "./learner-persona.js";
import { materialInstructions } from "./material-generation.js";

const delimitedMetadataSchema = z.object({
  position: z.number().int().min(1).max(100),
  cue: z.string().trim().min(1).max(2_000),
  note: z.string().trim().max(2_000),
  category: z.string().trim().max(80),
  focusTerms: z.array(z.string().trim().min(1).max(100)).max(8),
  disposition: z.enum(["active", "recognition", "skip"]),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]),
  currency: z.enum(["current", "contextual", "dated", "uncertain"]),
  personaFit: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  commonness: z.number().int().min(1).max(5),
});

const delimitedResponseSchema = z.object({ items: z.array(delimitedMetadataSchema).max(100) });
export type DelimitedMetadata = z.infer<typeof delimitedMetadataSchema>;

export const normalizeImportFragment = (value: string) => normalizeNfc(value).replace(/\s+/g, " ").trim();

export const splitDelimitedImport = (text: string) => {
  const fragments = text.split("$").map(normalizeImportFragment).filter(Boolean);
  if (!fragments.length) throw new Error("IMPORT_NO_FRAGMENTS");
  if (fragments.length > 100) throw new Error("IMPORT_TOO_MANY_FRAGMENTS");
  if (fragments.some((fragment) => fragment.length > 2_000)) throw new Error("IMPORT_FRAGMENT_TOO_LONG");
  return fragments;
};

export const buildDelimitedCandidates = (
  fragments: string[],
  metadata: DelimitedMetadata[],
): ReviewCandidate[] => {
  if (metadata.length !== fragments.length || metadata.some((item, index) => item.position !== index + 1)) {
    throw new Error("INCOMPLETE_DELIMITED_IMPORT");
  }
  return metadata.map((item, index) => {
    if (!focusTermsInTarget(fragments[index], item.focusTerms)) throw new Error("INVALID_IMPORT_FOCUS");
    return {
      ...item,
      id: randomUUID(),
      target: fragments[index],
      pattern: undefined,
    };
  });
};

const fragmentChunks = (fragments: string[]) => {
  const chunks: Array<Array<{ position: number; target: string }>> = [];
  let current: Array<{ position: number; target: string }> = [];
  let characters = 0;
  fragments.forEach((target, index) => {
    if (current.length && (current.length >= 25 || characters + target.length > 35_000)) {
      chunks.push(current); current = []; characters = 0;
    }
    current.push({ position: index + 1, target }); characters += target.length;
  });
  if (current.length) chunks.push(current);
  return chunks;
};

export async function prepareDelimitedImport(input: {
  client: OpenAI | null;
  repository: Pick<RehearsalRepository, "aiUsage" | "reviews">;
  learner: LearnerPersona;
  language: LanguageCode;
  title: string;
  text: string;
}) {
  if (!input.client) throw new Error("OPENAI_NOT_CONFIGURED");
  const fragments = splitDelimitedImport(input.text);
  const metadata: DelimitedMetadata[] = [];
  const operationId = randomUUID();
  for (const chunk of fragmentChunks(fragments)) {
    const requestInput = JSON.stringify({ title: input.title, fragments: chunk });
    const response = await trackAiRequest({
      repository: input.repository.aiUsage, provider: "openai", workload: "delimited_import_prepare",
      language: input.language, model: config.balancedModel, operationId,
      inputCharacters: requestInput.length, measure: responseTokenUsage,
    }, () => input.client!.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        input.learner,
        input.language,
        "The supplied target fragments are immutable. Return exactly one metadata item for every position, " +
          "in the same order. Do not merge, omit, reorder, translate, or rewrite target fragments. Generate only " +
          "a natural complete Russian cue, optional exact focusTerms copied from the target, and the requested metadata.",
      ),
      input: requestInput,
      text: { format: zodTextFormat(delimitedResponseSchema, "delimited_import_metadata") },
      max_output_tokens: aiLimits.batchOutputTokens,
    }));
    if (!response.output_parsed) throw new Error("INCOMPLETE_DELIMITED_IMPORT");
    const expectedPositions = chunk.map((fragment) => fragment.position);
    if (response.output_parsed.items.length !== chunk.length || response.output_parsed.items.some(
      (item, index) => item.position !== expectedPositions[index],
    )) throw new Error("INCOMPLETE_DELIMITED_IMPORT");
    metadata.push(...response.output_parsed.items);
  }
  const batch = input.repository.reviews.create({
    language: input.language,
    kind: "text_import",
    title: input.title,
    sourceText: input.text,
    destinationTopicTitle: input.title,
    candidates: buildDelimitedCandidates(fragments, metadata),
  });
  return { batch, mode: "openai" as const };
}
