import { describe, expect, it } from "vitest";
import { clampPlaybackSpeed, playbackStorageKey, speedRangeForProvider, storedPlaybackValue } from "./playbackSettings";

describe("playback settings", () => {
  it("uses the provider-specific speed range", () => {
    expect(speedRangeForProvider("openai")).toEqual({ min: 0.5, max: 1.5 });
    expect(speedRangeForProvider("elevenlabs")).toEqual({ min: 0.7, max: 1.2 });
  });

  it("never sends an unsupported speed to ElevenLabs", () => {
    expect(clampPlaybackSpeed("elevenlabs", 1.5)).toBe(1.2);
    expect(clampPlaybackSpeed("elevenlabs", 0.5)).toBe(0.7);
    expect(clampPlaybackSpeed("elevenlabs", 1.05)).toBe(1.05);
  });

  it("separates playback by profile and language and reads the legacy key for English only", () => {
    const values = new Map([
      ["rehearsal:oliver:playback", "legacy-en"],
      ["rehearsal:oliver:playback:vi", "vietnamese"],
    ]);
    const storage = { getItem: (key: string) => values.get(key) || null };
    expect(playbackStorageKey("oliver", "en")).toBe("rehearsal:oliver:playback:en");
    expect(playbackStorageKey("oliver", "vi")).toBe("rehearsal:oliver:playback:vi");
    expect(storedPlaybackValue(storage, "oliver", "en")).toBe("legacy-en");
    expect(storedPlaybackValue(storage, "oliver", "vi")).toBe("vietnamese");
    expect(storedPlaybackValue(storage, "roman", "vi")).toBeNull();
  });
});
