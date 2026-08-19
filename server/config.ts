import "dotenv/config";
import path from "node:path";

const root = process.cwd();

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const booleanFromEnv = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLocaleLowerCase());
};

export const config = {
  host: process.env.API_HOST || "127.0.0.1",
  port: numberFromEnv(process.env.API_PORT, 8787),
  databasePath: path.resolve(root, process.env.DATABASE_PATH || ".data/rehearsal.sqlite"),
  backupDir: path.resolve(root, process.env.BACKUP_DIR || "backups"),
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || "",
  tutorModel: process.env.OPENAI_TUTOR_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-5.6-sol",
  utilityModel: process.env.OPENAI_UTILITY_MODEL || "gpt-5.6-luna",
  balancedModel: process.env.OPENAI_BALANCED_MODEL || "gpt-5.6-terra",
  modelAutoUpdate: booleanFromEnv(process.env.OPENAI_MODEL_AUTO_UPDATE, true),
  modelCheckIntervalDays: numberFromEnv(process.env.OPENAI_MODEL_CHECK_INTERVAL_DAYS, 14),
  modelRoutingPath: path.resolve(root, process.env.OPENAI_MODEL_ROUTING_PATH || ".data/model-routing.json"),
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: numberFromEnv(process.env.OPENAI_EMBEDDING_DIMENSIONS, 512),
  transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe",
  ttsModel: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
  ttsVoice: process.env.OPENAI_TTS_VOICE || "marin",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || "",
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "1YGgSmpRGVzkcaI7zhbX",
  elevenLabsVoiceName: process.env.ELEVENLABS_VOICE_NAME || "Christopher",
  elevenLabsModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  elevenLabsStability: numberFromEnv(process.env.ELEVENLABS_STABILITY, 0.45),
  elevenLabsSimilarityBoost: numberFromEnv(process.env.ELEVENLABS_SIMILARITY_BOOST, 0.6),
  elevenLabsStyle: numberFromEnv(process.env.ELEVENLABS_STYLE, 0.02),
  elevenLabsSpeakerBoost: booleanFromEnv(process.env.ELEVENLABS_SPEAKER_BOOST, true),
  elevenLabsSpeed: numberFromEnv(process.env.ELEVENLABS_SPEED, 1.05),
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
};

export const openAIConfigured = Boolean(config.openaiApiKey);
export const elevenLabsConfigured = Boolean(config.elevenLabsApiKey);
