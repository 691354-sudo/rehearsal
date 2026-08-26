import { describe, expect, it } from "vitest";
import { shouldPauseForTelegram } from "./useTelegramPlaybackPause";

describe("Telegram foreground playback", () => {
  it("pauses only an actively playing Listen queue", () => {
    expect(shouldPauseForTelegram("player", "playing")).toBe(true);
    expect(shouldPauseForTelegram("player", "paused")).toBe(false);
    expect(shouldPauseForTelegram("setup", "playing")).toBe(false);
    expect(shouldPauseForTelegram("complete", "playing")).toBe(false);
  });
});
