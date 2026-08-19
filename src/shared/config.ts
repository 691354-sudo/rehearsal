import type {
  ElevenLabsConfig,
  PlaybackPreferences,
  SchedulerSettings,
} from "./contracts";
import { defaultElevenLabsSpeedRange } from "../lib/playbackSettings";

export const defaultPlayback: PlaybackPreferences = {
  provider: "openai",
  repetitions: 2,
  speed: 1,
  pauseMs: 1500,
  playAfterRecall: true,
  voice: "onyx",
  elevenlabs: {
    modelId: "eleven_multilingual_v2",
    stability: 0.45,
    similarityBoost: 0.6,
    style: 0.02,
    speakerBoost: true,
  },
};

export const defaultElevenLabsConfig: ElevenLabsConfig = {
  configured: false,
  voice: { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
  models: ["eleven_multilingual_v2", "eleven_flash_v2_5"],
  speedRange: defaultElevenLabsSpeedRange,
  defaults: { ...defaultPlayback.elevenlabs, speed: 1.05 },
  note: "Generated MP3 files are cached on this server.",
};

export const defaultSchedulerSettings: SchedulerSettings = {
  presets: {
    like: { requestRetention: 0.93, maximumInterval: 60 },
    neutral: { requestRetention: 0.9, maximumInterval: 180 },
    dislike: { requestRetention: 0.87, maximumInterval: 365 },
  },
  learningSteps: ["1m", "10m"],
  relearningSteps: ["1m", "10m"],
  fuzz: true,
  newItemsPerDay: 10,
};

export const defaultVoices = [
  "alloy", "echo", "fable", "nova", "onyx", "shimmer",
];

export const languageCopy = {
  en: { short: "EN", label: "English", locale: "en-US" },
  lv: { short: "LV", label: "Latviešu", locale: "lv-LV" },
} as const;

export const apiPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const humanizeLabel = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
