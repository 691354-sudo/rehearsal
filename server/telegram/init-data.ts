import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const telegramUserSchema = z.object({
  id: z.number().int().positive().safe(),
}).passthrough();

const telegramChatSchema = z.object({
  id: z.number().int().safe(),
  type: z.string().optional(),
}).passthrough();

export type TelegramInitData = {
  userId: string;
  chatId: string;
  authDate: number;
};

export class TelegramInitDataError extends Error {
  constructor(readonly code: "INVALID_TELEGRAM_INIT_DATA" | "TELEGRAM_INIT_DATA_EXPIRED") {
    super(code);
  }
}

export const validateTelegramInitData = (
  initData: string,
  botToken: string,
  now = Date.now(),
  maxAgeMs = 10 * 60 * 1_000,
): TelegramInitData => {
  if (!botToken || !initData || initData.length > 16_000) {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }
  const params = new URLSearchParams(initData);
  const keys = [...new Set([...params.keys()])];
  if (keys.some((key) => params.getAll(key).length !== 1)) {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }
  const receivedHash = params.get("hash") || "";
  if (!/^[0-9a-f]{64}$/i.test(receivedHash)) {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }
  const dataCheckString = keys.filter((key) => key !== "hash").sort()
    .map((key) => `${key}=${params.get(key) || ""}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secret).update(dataCheckString).digest();
  const received = Buffer.from(receivedHash, "hex");
  if (received.byteLength !== expectedHash.byteLength || !timingSafeEqual(received, expectedHash)) {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }

  const authDate = Number(params.get("auth_date"));
  const userRaw = params.get("user");
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || !userRaw) {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }
  let user: z.infer<typeof telegramUserSchema>;
  let chat: z.infer<typeof telegramChatSchema> | null = null;
  try {
    user = telegramUserSchema.parse(JSON.parse(userRaw));
    const chatRaw = params.get("chat");
    if (chatRaw) chat = telegramChatSchema.parse(JSON.parse(chatRaw));
  } catch {
    throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
  }
  const ageMs = now - authDate * 1_000;
  if (ageMs > maxAgeMs || ageMs < -30_000) {
    throw new TelegramInitDataError("TELEGRAM_INIT_DATA_EXPIRED");
  }
  return {
    userId: String(user.id),
    chatId: String(chat?.id ?? user.id),
    authDate,
  };
};
