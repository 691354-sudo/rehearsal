import type { TutorFeedback } from "../../contracts/tutor-feedback";
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

export type ChatMessage = {
  id: string;
  messageId?: number;
  feedback?: TutorFeedback | null;
  role: "user" | "assistant";
  content: string;
  clientMessageId?: string;
  status?: "sending" | "sent" | "failed" | "placeholder";
};
export type TtsProvider = "openai" | "elevenlabs";

export type ElevenLabsPreferences = {
  voiceId: string;
  modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
};

export type PlaybackPreferences = {
  provider: TtsProvider;
  repetitions: number;
  speed: number;
  playAfterRecall: boolean;
  voice: string;
  elevenlabs: ElevenLabsPreferences;
};

export type ElevenLabsConfig = {
  configured: boolean;
  voice: { id: string; name: string };
  voicesByLanguage: Partial<Record<Language, Array<{ id: string; name: string }>>>;
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
