import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LanguageCode, ReviewCandidate } from "../types.js";

export const generatedCandidateSchema = z.object({
  target: z.string(),
  cue: z.string(),
  note: z.string(),
  category: z.string(),
  focusTerms: z.array(z.string()),
  pattern: z.string(),
  disposition: z.enum(["active", "recognition", "skip"]),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]),
  currency: z.enum(["current", "contextual", "dated", "uncertain"]),
  personaFit: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  commonness: z.number().int().min(1).max(5),
});

export const generatedMaterialSchema = z.object({
  items: z.array(generatedCandidateSchema),
});

export const targetLanguageName = (language: LanguageCode) => language === "en" ? "English" : "Latvian";

export const materialInstructions = (language: LanguageCode, task: string) => `
You prepare optional learning cards for one Russian-speaking adult born in 1992 who is learning ${targetLanguageName(language)}.
${task}

Content policy:
- Match his actual direct, casual, thoughtful speaking style. Prefer neutral adult conversational language and useful collocations.
- Current means natural in 2026. Avoid dated, bookish, corporate, overly formal, or forced Gen-Z wording.
- Never create isolated word-definition cards. Put a focus word inside a complete useful sentence.
- target must contain only the complete target-language sentence. Never prefix it with the focus term, a label, a dash, or a definition.
- cue must be a complete natural Russian sentence with the same meaning as target. Never return a dictionary definition or several glosses separated by punctuation.
- focusTerms is the only field for the exact word or phrase being trained.
- category is a real-life situation such as café, gym, work, relationships, travel, or life in Riga; never use grammatical labels such as conditional or phrasal verb.
- Prefer one strong personal anchor over many generic examples. Use Riga, travel, nature, relationships, health, work, and everyday life only when they genuinely fit.
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
