import { describe, expect, it } from "vitest";
import { parseTelegramUserProfileAccess } from "./access.js";

describe("Telegram user profile access", () => {
  it("parses exact profile scopes per Telegram user", () => {
    expect(parseTelegramUserProfileAccess(JSON.stringify({
      101: ["roman", "pilot-profile"],
      202: ["oliver"],
    }))).toEqual({
      101: ["roman", "pilot-profile"],
      202: ["oliver"],
    });
  });

  it.each([
    "not-json",
    "[]",
    JSON.stringify({ invalid: ["roman"] }),
    JSON.stringify({ 101: [] }),
    JSON.stringify({ 101: ["roman", "roman"] }),
  ])("rejects malformed access rules: %s", (raw) => {
    expect(() => parseTelegramUserProfileAccess(raw)).toThrow(/TELEGRAM_USER_PROFILE_ACCESS/);
  });
});
