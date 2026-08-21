import type {
  ChatThread,
  DailyProgress,
  Island,
  IslandSummary,
  ItemPreference,
  LanguageCode,
  LanguageOption,
  LearningItem,
  SchedulerSettings,
} from "../../contracts/api";
import type { DiffToken } from "../types/practice";

export type {
  ChatThread,
  DailyProgress,
  Island,
  IslandSummary,
  ItemPreference,
  LanguageOption,
  LearningItem,
  SchedulerSettings,
};

export type Language = LanguageCode;
export type Theme = "light" | "dark";

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
  voiceId: string;
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
  playAfterRecall: boolean;
  voice: string;
  elevenlabs: ElevenLabsPreferences;
};

export type ElevenLabsConfig = {
  configured: boolean;
  voice: { id: string; name: string };
  voices: { id: string; name: string }[];
  models: ElevenLabsPreferences["modelId"][];
  speedRange: { min: number; max: number };
  defaults: ElevenLabsPreferences & { speed: number };
  languageDefaults: Partial<Record<Language, {
    voiceId: string;
    voiceName: string;
    modelId: ElevenLabsPreferences["modelId"];
  }>>;
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
