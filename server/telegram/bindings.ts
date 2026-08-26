import type { LanguageCode } from "../../contracts/api.js";
import { isLanguageCode } from "../../contracts/api.js";
import type { RehearsalDatabase } from "../db/database.js";

export const telegramBindingsSettingKey = "telegram_bindings_v1";

export type TelegramMode = "notebook" | "tutor";

export type TelegramBinding = {
  userId: string;
  chatId: string;
  language: LanguageCode;
  mode: TelegramMode;
  tutorThreadId: string | null;
};

const telegramIdPattern = /^-?\d{1,20}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isBinding = (value: unknown): value is TelegramBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<TelegramBinding>;
  return typeof binding.userId === "string" && telegramIdPattern.test(binding.userId)
    && typeof binding.chatId === "string" && telegramIdPattern.test(binding.chatId)
    && isLanguageCode(binding.language)
    && (binding.mode === "notebook" || binding.mode === "tutor")
    && (binding.tutorThreadId === null
      || (typeof binding.tutorThreadId === "string" && uuidPattern.test(binding.tutorThreadId)));
};

export const readTelegramBindings = (db: RehearsalDatabase): TelegramBinding[] => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(telegramBindingsSettingKey) as { value: string } | undefined;
  if (!row) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw new Error("INVALID_TELEGRAM_BINDINGS_SETTING");
  }
  if (!Array.isArray(parsed) || !parsed.every(isBinding)) {
    throw new Error("INVALID_TELEGRAM_BINDINGS_SETTING");
  }
  if (new Set(parsed.map((binding) => binding.userId)).size !== parsed.length) {
    throw new Error("DUPLICATE_TELEGRAM_BINDING");
  }
  return parsed.map((binding) => ({ ...binding }));
};

export const writeTelegramBindings = (db: RehearsalDatabase, bindings: TelegramBinding[]) => {
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(telegramBindingsSettingKey, JSON.stringify(bindings));
};
