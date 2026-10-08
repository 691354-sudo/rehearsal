import { z } from "zod";
import type { LanguageCode } from "./api.js";

export const firstTutorExerciseMessage = "Let's begin my first short exercise. Choose a useful situation for me and guide me according to my saved preferences.";

export const tutorModes = ["beginner", "intermediate", "advanced"] as const;
export const tutorModeSchema = z.enum(tutorModes);
export type TutorMode = z.infer<typeof tutorModeSchema>;
export const tutorSettingsSchema = z.object({
  initiative: z.enum(["tutor", "shared", "user"]),
  instructionDetail: z.enum(["step_by_step", "short", "minimal"]),
  answerSupport: z.enum(["full", "partial", "on_request"]),
  topicSelection: z.enum(["tutor_selects", "offer_choices", "user_selects"]),
  correctionStyle: z.enum(["hint_then_model", "hint_first", "important_only"]),
  nativeLanguageUsage: z.enum(["allowed", "when_needed", "on_request"]),
  newLanguageAmount: z.enum(["low", "medium", "high"]),
}).strict();
export const tutorOverridesSchema = tutorSettingsSchema.partial();
export type TutorModeConfig = z.infer<typeof tutorSettingsSchema>;
export const onboardingAnswersSchema = z.object({
  comfort: tutorModeSchema.optional(),
  goals: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
  interests: z.string().trim().max(500).optional(),
  preference: tutorModeSchema.optional(),
  sample: z.string().trim().max(1000).optional(),
  needsModel: z.boolean().optional(),
}).strict();
export type OnboardingAnswers = z.infer<typeof onboardingAnswersSchema>;
export type TutorLearningProfile = {
  nativeLanguage: string; targetLanguage: LanguageCode;
  onboardingStatus: "not_started" | "in_progress" | "completed" | "skipped";
  onboardingStep: number; answers: OnboardingAnswers;
  interactionMode: TutorMode; customTutorSettings: Partial<TutorModeConfig>;
  goals: string[]; interests: string[]; preferredTopics: string[];
  completedTutorSessions: number; lastReassessmentSessionCount: number;
  nextReassessmentAtSession: number; lastReassessmentAt: string | null;
  firstExerciseThreadId: string | null; firstExerciseMessageId: string | null;
  firstExerciseStartedAt?: string; firstExerciseCompletedAt?: string;
  onboardingStartedAt?: string;
  createdAt: string; updatedAt: string;
};
export const adaptationSummarySchema = z.object({
  meaningfulActivities: z.number().int().min(0).max(100),
  answeredIndependently: z.boolean(),
  understoodInstructionsWithoutExtraHelp: z.boolean(),
  selectedDirectionIndependently: z.boolean(),
  requiredExamplesFrequently: z.boolean(),
  requiredNativeLanguageSupportFrequently: z.boolean(),
  handledOpenQuestions: z.boolean(),
  explicitlyRequestedMoreHelp: z.boolean(),
  explicitlyRequestedLessHelp: z.boolean(),
}).strict();
export type TutorSessionSummary = z.infer<typeof adaptationSummarySchema>;
export const reassessmentSchema = z.object({
  decision: z.enum(["keep", "move_up", "move_down"]),
  reason_codes: z.array(z.string().max(60)).max(8),
}).strict();
