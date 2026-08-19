import type { ReviewRating } from "../lib/sessionQueue";
import type { DiffToken } from "../types/practice";

export type Mode = "recall" | "shadow";
export type Theme = "light" | "dark";
export type Route = "practice" | "tutor" | "library";
export type Language = "en" | "lv";
export type ItemPreference = "like" | "neutral" | "dislike";

export type LearningItem = {
  publicId: string;
  language: Language;
  cue: string;
  target: string;
  acceptedAnswers?: string[];
  note: string;
  source: string;
  status: "new" | "learning" | "strong";
  preference: ItemPreference;
  tags: string[];
  frequencyBand?: "core" | "common" | "specific" | "rare";
  currency?: "current" | "contextual" | "dated" | "uncertain";
  personaFit?: number;
  practiceEnabled?: boolean;
  schedule?: {
    state: "new" | "learning" | "review" | "relearning";
    dueAt: string;
    retrievability: number | null;
    options: Record<ReviewRating, { dueAt: string; intervalSeconds: number }>;
  };
};

export type Evaluation = {
  score: number;
  verdict: "exact" | "close" | "retry";
  naturalAnswer: string;
  correctedAnswer: string;
  summaryRu: string;
  mistakes: Array<{ original: string; correction: string; explanationRu: string }>;
  expectedTokens?: DiffToken[];
  answerTokens?: DiffToken[];
};

export type AttemptDraft = { answer: string; evaluation?: Evaluation };
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
export type ChatThread = {
  publicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type TtsProvider = "openai" | "elevenlabs";
export type ElevenLabsPreferences = {
  modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
};
export type PlaybackPreferences = {
  provider: TtsProvider;
  repetitions: number;
  speed: number;
  pauseMs: number;
  voice: string;
  elevenlabs: ElevenLabsPreferences;
};
export type ElevenLabsConfig = {
  configured: boolean;
  voice: { id: string; name: string };
  models: ElevenLabsPreferences["modelId"][];
  speedRange: { min: number; max: number };
  defaults: ElevenLabsPreferences & { speed: number };
  note: string;
};
export type ElevenLabsVoiceStatus = {
  configured: boolean;
  reachable: boolean;
  checkedAt: string;
  voice: {
    id: string;
    name: string;
    category: string;
    description: string;
    labels: Record<string, string>;
  };
  error: string;
};
export type PlaybackResult = {
  provider: TtsProvider | "browser";
  cache: "HIT" | "MISS" | null;
};
export type SchedulerSettings = {
  presets: Record<ItemPreference, { requestRetention: number; maximumInterval: number }>;
  learningSteps: string[];
  relearningSteps: string[];
  fuzz: boolean;
  newItemsPerDay: number;
};
export type DailyProgress = { recall: number; shadow: number; pattern: number };
