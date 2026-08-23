import type { Language, PlaybackPreferences, TtsProvider } from "../../shared/contracts";

export type PreparedAudio = {
  blob: Blob;
  cache: "HIT" | "MISS" | null;
  provider: TtsProvider;
};

export type AudioPreparationJob = {
  jobId: string;
  status: "preparing" | "ready" | "failed" | "cancelled";
  total: number;
  ready: number;
  initialCached: number;
  items: Array<{
    itemId: string;
    status: "pending" | "preparing" | "ready" | "failed" | "cancelled";
    error?: string;
  }>;
};

export const adaptivePauseMs = (durationMs: number) =>
  Math.max(1_000, Math.min(15_000, Math.round(durationMs + 500)));

export const nextQueueIndex = (index: number, length: number, loop: boolean) =>
  index + 1 < length ? index + 1 : loop && length ? 0 : null;

export type RepeatMode = "off" | "all" | "one";

export const nextRepeatMode = (mode: RepeatMode): RepeatMode =>
  mode === "off" ? "all" : mode === "all" ? "one" : "off";

export const nextAutomaticIndex = (index: number, length: number, mode: RepeatMode) =>
  mode === "one" ? index : nextQueueIndex(index, length, mode === "all");

export const markListenedOnce = (
  listened: Set<string>,
  itemId: string,
  commit: (itemId: string) => Promise<void>,
) => {
  if (listened.has(itemId)) return false;
  listened.add(itemId);
  void commit(itemId).catch(() => undefined);
  return true;
};

export const shuffleQueue = <Item,>(items: readonly Item[], random = Math.random) => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[next]] = [shuffled[next], shuffled[index]];
  }
  if (shuffled.length > 1 && shuffled.every((item, index) => item === items[index])) {
    shuffled.push(shuffled.shift()!);
  }
  return shuffled;
};

export const playbackIdentity = (language: Language, playback: PlaybackPreferences) => JSON.stringify({
  language,
  provider: playback.provider,
  voice: playback.provider === "elevenlabs" ? playback.elevenlabs.voiceId : playback.voice,
  model: playback.provider === "elevenlabs" ? playback.elevenlabs.modelId : "tts-1-hd",
  speed: playback.speed,
});

export const preparationBody = (
  itemIds: string[],
  language: Language,
  playback: PlaybackPreferences,
) => ({
  itemIds,
  priorityItemId: itemIds[0],
  language,
  provider: playback.provider,
  speed: playback.speed,
  voice: playback.voice,
  ...playback.elevenlabs,
});
