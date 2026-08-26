import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { LanguageCode } from "../contracts/api.js";

const root = process.cwd();
const databasePath = path.resolve(root, process.env.DATABASE_PATH || ".data/rehearsal.sqlite");
const openAiTtsVoices = ["alloy", "echo", "fable", "nova", "onyx", "shimmer"] as const;

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLocaleLowerCase());
};

const secretFromEnv = (name: string) => {
  const filePath = process.env[`${name}_FILE`]?.trim();
  if (filePath) return fs.readFileSync(filePath, "utf8").trim();
  return process.env[name]?.trim() || "";
};

const secretFromFile = (name: string) => {
  const filePath = process.env[`${name}_FILE`]?.trim();
  return filePath ? fs.readFileSync(filePath, "utf8").trim() : "";
};

const listFromEnv = (name: string) => secretFromEnv(name).split(",")
  .map((value) => value.trim()).filter(Boolean);

const openAiTtsVoiceFromEnv = () => {
  const configured = process.env.OPENAI_TTS_VOICE?.trim();
  return openAiTtsVoices.find((voice) => voice === configured) || "onyx";
};

export const config = {
  host: process.env.API_HOST || "127.0.0.1",
  port: numberFromEnv(process.env.API_PORT, 8787),
  databasePath,
  dataDir: path.resolve(root, process.env.DATA_DIR || path.dirname(databasePath)),
  backupDir: path.resolve(root, process.env.BACKUP_DIR || "backups"),
  romanProfilePin: secretFromEnv("ROMAN_PROFILE_PIN"),
  oliverProfilePin: secretFromEnv("OLIVER_PROFILE_PIN"),
  zannaProfilePin: secretFromEnv("ZANNA_PROFILE_PIN"),
  sessionSecret: secretFromEnv("SESSION_SECRET"),
  telegramBotToken: secretFromFile("TELEGRAM_BOT_TOKEN"),
  telegramAllowedProfileIds: listFromEnv("TELEGRAM_ALLOWED_PROFILE_IDS"),
  telegramMiniAppUrl: process.env.TELEGRAM_MINI_APP_URL?.trim() || "",
  sessionCookieSecure: booleanFromEnv(
    process.env.SESSION_COOKIE_SECURE,
    process.env.NODE_ENV === "production",
  ),
  trustedProxy: process.env.TRUST_PROXY?.trim() || false,
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  tutorModel: process.env.OPENAI_TUTOR_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-5.6-sol",
  utilityModel: process.env.OPENAI_UTILITY_MODEL || "gpt-5.6-luna",
  balancedModel: process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: numberFromEnv(process.env.OPENAI_EMBEDDING_DIMENSIONS, 512),
  transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe",
  ttsModel: process.env.OPENAI_TTS_MODEL || "tts-1-hd",
  ttsVoice: openAiTtsVoiceFromEnv(),
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "1YGgSmpRGVzkcaI7zhbX",
  elevenLabsVoiceName: process.env.ELEVENLABS_VOICE_NAME || "Christopher",
  elevenLabsViVoiceId: process.env.ELEVENLABS_VI_VOICE_ID?.trim() || "ueSxRO0nLF1bj93J2hVt",
  elevenLabsViVoiceName: process.env.ELEVENLABS_VI_VOICE_NAME?.trim() || "Trung Caha",
  elevenLabsNoVoiceId: process.env.ELEVENLABS_NO_VOICE_ID?.trim() || "",
  elevenLabsNoVoiceName: process.env.ELEVENLABS_NO_VOICE_NAME?.trim() || "Norwegian voice",
  elevenLabsIdVoiceId: process.env.ELEVENLABS_ID_VOICE_ID?.trim() || "3mAVBNEqop5UbHtD8oxQ",
  elevenLabsIdVoiceName: process.env.ELEVENLABS_ID_VOICE_NAME?.trim() || "Zephlyn",
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  elevenLabsSpeed: numberFromEnv(process.env.ELEVENLABS_SPEED, 1.05),
};

export const openAIConfigured = Boolean(config.openaiApiKey);
export const elevenLabsConfigured = Boolean(config.elevenLabsApiKey);

export type ElevenLabsVoiceOption = { id: string; name: string; languages: LanguageCode[] };

const configuredElevenLabsVoices: ElevenLabsVoiceOption[] = [
  { id: config.elevenLabsVoiceId, name: config.elevenLabsVoiceName, languages: ["en"] as LanguageCode[] },
  { id: config.elevenLabsViVoiceId, name: config.elevenLabsViVoiceName, languages: ["vi"] as LanguageCode[] },
  { id: "kdnRe2koJdOK4Ovxn2DI", name: "Eryn", languages: ["en"] as LanguageCode[] },
  { id: "uFIXVu9mmnDZ7dTKCBTX", name: "Justin Time", languages: ["en"] as LanguageCode[] },
  { id: "ZF6FPAbjXT4488VcRRnw", name: "Amelia", languages: ["en"] as LanguageCode[] },
  { id: "ocDS3nMDsIPV8dFsOOyf", name: "Sean Buckley", languages: ["en"] as LanguageCode[] },
  ...(config.elevenLabsNoVoiceId ? [{
    id: config.elevenLabsNoVoiceId,
    name: config.elevenLabsNoVoiceName,
    languages: ["no"] as LanguageCode[],
  }] : []),
  {
    id: config.elevenLabsIdVoiceId,
    name: config.elevenLabsIdVoiceName,
    languages: ["id"] as LanguageCode[],
  },
];

export const elevenLabsVoices = [...configuredElevenLabsVoices.reduce((voices, voice) => {
  const existing = voices.get(voice.id);
  if (existing) existing.languages = [...new Set([...existing.languages, ...voice.languages])];
  else voices.set(voice.id, { ...voice, languages: [...voice.languages] });
  return voices;
}, new Map<string, ElevenLabsVoiceOption>()).values()];
