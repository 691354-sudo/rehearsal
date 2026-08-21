import type {
  ElevenLabsConfig,
  PlaybackPreferences,
  SchedulerSettings,
} from "./contracts";
import { languageCatalog, languageCodes } from "../../contracts/api";
import { defaultElevenLabsSpeedRange } from "../lib/playbackSettings";

export const defaultPlayback: PlaybackPreferences = {
  provider: "openai",
  repetitions: 2,
  speed: 1,
  pauseMs: 1500,
  playAfterRecall: true,
  voice: "onyx",
  elevenlabs: {
    voiceId: "1YGgSmpRGVzkcaI7zhbX",
    modelId: "eleven_multilingual_v2",
    stability: 0.45,
    similarityBoost: 0.6,
    style: 0.02,
    speakerBoost: true,
  },
};

export const defaultPlaybackForLanguage = (
  language: keyof typeof languageCatalog,
  elevenLabs = defaultElevenLabsConfig,
): PlaybackPreferences => language === "vi" ? {
  ...defaultPlayback,
  provider: "elevenlabs",
  elevenlabs: {
    ...defaultPlayback.elevenlabs,
    voiceId: elevenLabs.languageDefaults.vi?.voiceId || "ueSxRO0nLF1bj93J2hVt",
    modelId: "eleven_flash_v2_5",
  },
} : defaultPlayback;

export const defaultElevenLabsConfig: ElevenLabsConfig = {
  configured: false,
  voice: { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
  voices: [
    { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
    { id: "kdnRe2koJdOK4Ovxn2DI", name: "Eryn" },
    { id: "uFIXVu9mmnDZ7dTKCBTX", name: "Justin Time" },
    { id: "ZF6FPAbjXT4488VcRRnw", name: "Amelia" },
    { id: "ocDS3nMDsIPV8dFsOOyf", name: "Sean Buckley" },
    { id: "ueSxRO0nLF1bj93J2hVt", name: "Trung Caha" },
  ],
  models: ["eleven_multilingual_v2", "eleven_flash_v2_5"],
  speedRange: defaultElevenLabsSpeedRange,
  defaults: { ...defaultPlayback.elevenlabs, speed: 1.05 },
  languageDefaults: {
    vi: { voiceId: "ueSxRO0nLF1bj93J2hVt", voiceName: "Trung Caha", modelId: "eleven_flash_v2_5" },
  },
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

export const languageCopy = Object.fromEntries(languageCodes.map((code) => [code, {
  ...languageCatalog[code],
  short: code.toUpperCase(),
}])) as Record<keyof typeof languageCatalog, typeof languageCatalog[keyof typeof languageCatalog] & { short: string }>;

export const languageHasAudio = (language: keyof typeof languageCatalog) =>
  languageCopy[language].capabilities.audio;

export const apiPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const humanizeLabel = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
