import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

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
  sessionSecret: secretFromEnv("SESSION_SECRET"),
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
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  elevenLabsStability: numberFromEnv(process.env.ELEVENLABS_STABILITY, 0.45),
  elevenLabsSimilarityBoost: numberFromEnv(process.env.ELEVENLABS_SIMILARITY_BOOST, 0.6),
  elevenLabsStyle: numberFromEnv(process.env.ELEVENLABS_STYLE, 0.02),
  elevenLabsSpeakerBoost: booleanFromEnv(process.env.ELEVENLABS_SPEAKER_BOOST, true),
  elevenLabsSpeed: numberFromEnv(process.env.ELEVENLABS_SPEED, 1.05),
};

export const openAIConfigured = Boolean(config.openaiApiKey);
export const elevenLabsConfigured = Boolean(config.elevenLabsApiKey);

export const elevenLabsVoices = Array.from(new Map([
  { id: config.elevenLabsVoiceId, name: config.elevenLabsVoiceName },
  { id: "kdnRe2koJdOK4Ovxn2DI", name: "Eryn" },
  { id: "uFIXVu9mmnDZ7dTKCBTX", name: "Justin Time" },
  { id: "ZF6FPAbjXT4488VcRRnw", name: "Amelia" },
].map((voice) => [voice.id, voice])).values());
