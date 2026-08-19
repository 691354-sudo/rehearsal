import { describe, expect, it } from "vitest";
import { clampPlaybackSpeed, speedRangeForProvider } from "./playbackSettings";

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
});
