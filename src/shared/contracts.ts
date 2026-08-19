import type {
  ChatThread,
  DailyProgress,
  ItemPreference,
  LanguageCode,
  LearningItem,
  SchedulerSettings,
} from "../../contracts/api";
import type { DiffToken } from "../types/practice";

export type {
  ChatThread,
  DailyProgress,
  ItemPreference,
  LearningItem,
  SchedulerSettings,
};

export type Language = LanguageCode;
export type Mode = "recall" | "shadow";
export type Theme = "light" | "dark";
export type Route = "practice" | "tutor" | "library";

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
