import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TelegramInitDataError, validateTelegramInitData } from "./init-data.js";

const token = "123456:test-token";

const signedInitData = (input: { userId?: number; authDate?: number; includeUser?: boolean } = {}) => {
  const params = new URLSearchParams();
  if (input.includeUser !== false) params.set("user", JSON.stringify({ id: input.userId || 123456789, first_name: "Test" }));
  if (input.authDate !== undefined) params.set("auth_date", String(input.authDate));
  params.set("query_id", "AAE-test-query");
  const check = [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
};

describe("Telegram Mini App initData", () => {
  it("validates the official HMAC shape and extracts only stable ids", () => {
    const now = Date.UTC(2026, 7, 26, 10, 0, 0);
    expect(validateTelegramInitData(signedInitData({ authDate: now / 1_000 }), token, now)).toEqual({
      userId: "123456789",
      chatId: "123456789",
      authDate: now / 1_000,
    });
  });

  it("rejects tampered, expired, future, and incomplete payloads", () => {
    const now = Date.UTC(2026, 7, 26, 10, 0, 0);
    const valid = signedInitData({ authDate: now / 1_000 });
    expect(() => validateTelegramInitData(valid.replace("123456789", "123456788"), token, now))
      .toThrowError(TelegramInitDataError);
    expect(() => validateTelegramInitData(signedInitData({ authDate: now / 1_000 - 601 }), token, now))
      .toThrow("TELEGRAM_INIT_DATA_EXPIRED");
    expect(() => validateTelegramInitData(signedInitData({ authDate: now / 1_000 + 31 }), token, now))
      .toThrow("TELEGRAM_INIT_DATA_EXPIRED");
    expect(() => validateTelegramInitData(signedInitData({ authDate: now / 1_000, includeUser: false }), token, now))
      .toThrow("INVALID_TELEGRAM_INIT_DATA");
  });
});
