import type { LanguageCode, ProfileId } from "../../contracts/api";

export type PlaybackProvider = "openai" | "elevenlabs";

export type SpeedRange = { min: number; max: number };

export const openAiSpeedRange: SpeedRange = { min: 0.5, max: 1.5 };
export const defaultElevenLabsSpeedRange: SpeedRange = { min: 0.7, max: 1.2 };

export const speedRangeForProvider = (
  provider: PlaybackProvider,
  elevenLabsRange = defaultElevenLabsSpeedRange,
) => provider === "elevenlabs" ? elevenLabsRange : openAiSpeedRange;

export const clampPlaybackSpeed = (
  provider: PlaybackProvider,
  speed: number,
  elevenLabsRange = defaultElevenLabsSpeedRange,
) => {
  const range = speedRangeForProvider(provider, elevenLabsRange);
  return Math.max(range.min, Math.min(range.max, speed));
};

export const playbackStorageKey = (profileId: ProfileId, language: LanguageCode) =>
  `rehearsal:${profileId}:playback:${language}`;

export const storedPlaybackValue = (
  storage: Pick<Storage, "getItem">,
  profileId: ProfileId,
  language: LanguageCode,
) => storage.getItem(playbackStorageKey(profileId, language))
  || (language === "en" ? storage.getItem(`rehearsal:${profileId}:playback`) : null);
