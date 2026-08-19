import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LanguageCode, ReviewCandidate } from "../types.js";
import type { LearnerPersona } from "./learner-persona.js";

export const generatedCandidateSchema = z.object({
  target: z.string().min(1).max(2_000),
  cue: z.string().min(1).max(2_000),
  note: z.string().max(2_000),
  category: z.string().max(80),
  focusTerms: z.array(z.string().min(1).max(100)).max(8),
  pattern: z.string().max(500),
  disposition: z.enum(["active", "recognition", "skip"]),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]),
  currency: z.enum(["current", "contextual", "dated", "uncertain"]),
  personaFit: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  commonness: z.number().int().min(1).max(5),
});

export const generatedMaterialSchema = z.object({
  items: z.array(generatedCandidateSchema).max(100),
});

export const targetLanguageName = (language: LanguageCode) => language === "en" ? "English" : "Latvian";

export const materialInstructions = (learner: LearnerPersona, language: LanguageCode, task: string) => `
You prepare optional learning cards for ${learner.name}, who is learning ${targetLanguageName(language)}.
${learner.context}
${task}

Content policy:
- Match the learner's known speaking style when it is supplied. Prefer neutral adult conversational language and useful collocations.
- Current means natural in ${new Date().getFullYear()}. Avoid dated, bookish, corporate, overly formal, or forced Gen-Z wording.
- Never create isolated word-definition cards. Put a focus word inside a complete useful sentence.
- target must contain only the complete target-language sentence. Never prefix it with the focus term, a label, a dash, or a definition.
- cue must be a complete natural Russian sentence with the same meaning as target. Never return a dictionary definition or several glosses separated by punctuation.
- focusTerms is the only field for the exact word or phrase being trained.
- category is a real-life situation such as café, gym, work, relationships, travel, or daily errands; never use grammatical labels such as conditional or phrasal verb.
- Prefer one strong relevant anchor over many generic examples, without inventing personal details.
- Russian cues must carry the same natural meaning, not word-for-word translation.
- Keep every target sentence speakable and worth active recall. Pattern drills vary one meaningful slot while preserving the structure.
- Mark rare or dated input as recognition or skip instead of forcing it into active vocabulary.
- Do not claim anything was saved. These are proposals requiring the user's approval.

Metadata:
- frequencyBand: core, common, specific, or rare.
- currency: current, contextual, dated, or uncertain.
- personaFit: 1-5 for this specific adult speaker.
- disposition: active, recognition, or skip.
- pattern must describe the reusable language construction, such as a conditional, phrasal verb, or sentence frame, or be an empty string.
`;

export const toCandidate = (item: z.infer<typeof generatedCandidateSchema>): ReviewCandidate => ({
  ...item,
  id: randomUUID(),
  focusTerms: item.focusTerms.slice(0, 8),
  pattern: item.pattern || undefined,
});
