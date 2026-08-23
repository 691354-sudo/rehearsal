import { describe, expect, it } from "vitest";
import { defaultPlayback } from "../../shared/config";
import {
  adaptivePauseMs, markListenedOnce, nextAutomaticIndex, nextQueueIndex, nextRepeatMode, playbackIdentity,
  preparationBody, shuffleQueue,
} from "./listenAudio";

describe("Listen & Repeat audio helpers", () => {
  it("derives the adaptive pause from MP3 duration within safe limits", () => {
    expect(adaptivePauseMs(0)).toBe(1_000);
    expect(adaptivePauseMs(2_000)).toBe(2_500);
    expect(adaptivePauseMs(20_000)).toBe(15_000);
  });

  it("creates a new order only when shuffle is explicitly called", () => {
    const cards = ["one", "two", "three"];
    expect(cards).toEqual(["one", "two", "three"]);
    expect(shuffleQueue(cards, () => 0.999)).toEqual(["two", "three", "one"]);
    expect(cards).toEqual(["one", "two", "three"]);
  });

  it("loops only after the final card when loop is enabled", () => {
    expect(nextQueueIndex(0, 3, false)).toBe(1);
    expect(nextQueueIndex(2, 3, false)).toBeNull();
    expect(nextQueueIndex(2, 3, true)).toBe(0);
  });

  it("cycles repeat from queue to one card and applies it only to automatic progress", () => {
    expect(nextRepeatMode("off")).toBe("all");
    expect(nextRepeatMode("all")).toBe("one");
    expect(nextRepeatMode("one")).toBe("off");
    expect(nextAutomaticIndex(2, 3, "off")).toBeNull();
    expect(nextAutomaticIndex(2, 3, "all")).toBe(0);
    expect(nextAutomaticIndex(2, 3, "one")).toBe(2);
    expect(nextQueueIndex(1, 3, false)).toBe(2);
  });

  it("records listening only once per card in a session", () => {
    const listened = new Set<string>();
    const calls: string[] = [];
    const commit = async (itemId: string) => { calls.push(itemId); };
    expect(markListenedOnce(listened, "card", commit)).toBe(true);
    expect(markListenedOnce(listened, "card", commit)).toBe(false);
    expect(calls).toEqual(["card"]);
  });

  it("separates memory buffers by provider voice, model, and speed", () => {
    const base = { ...defaultPlayback, elevenlabs: { ...defaultPlayback.elevenlabs } };
    const identity = playbackIdentity("en", base);
    expect(playbackIdentity("en", { ...base, repetitions: 5 })).toBe(identity);
    expect(playbackIdentity("en", { ...base, speed: 1.1 })).not.toBe(identity);
    expect(playbackIdentity("en", {
      ...base, provider: "elevenlabs", elevenlabs: { ...base.elevenlabs, voiceId: "other" },
    })).not.toBe(identity);
    expect(playbackIdentity("en", {
      ...base,
      provider: "elevenlabs",
      elevenlabs: { ...base.elevenlabs, modelId: "eleven_flash_v2_5" },
    })).not.toBe(identity);
  });

  it("sends only stable playback settings and an explicit priority item", () => {
    const body = preparationBody(["first", "second"], "en", defaultPlayback);
    expect(body).toMatchObject({
      itemIds: ["first", "second"],
      priorityItemId: "first",
      provider: "openai",
      speed: 1,
    });
    expect(body).not.toHaveProperty("stability");
    expect(body).not.toHaveProperty("similarityBoost");
    expect(body).not.toHaveProperty("style");
    expect(body).not.toHaveProperty("speakerBoost");
  });
});
