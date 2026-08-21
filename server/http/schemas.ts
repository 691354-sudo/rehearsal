import type { StepUnit } from "ts-fsrs";
import { z } from "zod";
import type { SchedulerSettings } from "../services/scheduler.js";
import { languageCodes } from "../../contracts/api.js";
import { normalizeNfc } from "../../contracts/text.js";

export const languageSchema = z.enum(languageCodes as [typeof languageCodes[number], ...typeof languageCodes]);

export const voiceOptions = [
  "alloy", "echo", "fable", "nova", "onyx", "shimmer",
] as const;

export const elevenLabsModelOptions = ["eleven_multilingual_v2", "eleven_flash_v2_5"] as const;

export const nfcText = (maximum: number) => z.string().trim().min(1).max(maximum).transform(normalizeNfc);

const stepSchema = z.custom<StepUnit>(
  (value) => typeof value === "string" && /^\d+(?:\.\d+)?[mhd]$/.test(value),
  "Use a duration such as 1m, 2h, or 1d",
);

const schedulerPresetSchema = z.object({
  requestRetention: z.number().min(0.8).max(0.97),
  maximumInterval: z.number().int().min(7).max(3650),
});

export const schedulerSettingsSchema = z.object({
  presets: z.object({
    like: schedulerPresetSchema,
    neutral: schedulerPresetSchema,
    dislike: schedulerPresetSchema,
  }),
  learningSteps: z.array(stepSchema).min(1).max(4),
  relearningSteps: z.array(stepSchema).min(1).max(4),
  fuzz: z.boolean(),
  newItemsPerDay: z.number().int().min(0).max(30).default(10),
}) satisfies z.ZodType<SchedulerSettings>;

export const itemBodySchema = z.object({
  language: languageSchema,
  target: nfcText(2_000),
  cue: z.string().trim().min(1).max(2_000),
  note: z.string().trim().max(2_000).optional(),
  kind: z.enum(["phrase", "island_line", "correction", "story_line"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  frequencyBand: z.enum(["core", "common", "specific", "rare"]).optional(),
});

export const reviewCandidateSelectionSchema = z.object({
  id: z.string().uuid(),
  target: nfcText(2_000),
  cue: z.string().trim().min(1).max(2_000),
  note: z.string().trim().max(2_000),
  category: z.string().trim().max(80),
});
