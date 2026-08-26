export type TelegramUserProfileAccess = Readonly<Record<string, readonly string[]>>;

const telegramUserIdPattern = /^\d{1,20}$/;

export const parseTelegramUserProfileAccess = (raw: string): TelegramUserProfileAccess => {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TELEGRAM_USER_PROFILE_ACCESS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TELEGRAM_USER_PROFILE_ACCESS must be a JSON object");
  }

  const access: Record<string, readonly string[]> = {};
  for (const [userId, profileIds] of Object.entries(parsed)) {
    if (!telegramUserIdPattern.test(userId)) {
      throw new Error("TELEGRAM_USER_PROFILE_ACCESS contains an invalid Telegram user ID");
    }
    if (!Array.isArray(profileIds) || !profileIds.length
      || profileIds.some((profileId) => typeof profileId !== "string"
        || !profileId.trim() || profileId.length > 64)) {
      throw new Error("TELEGRAM_USER_PROFILE_ACCESS contains an invalid profile list");
    }
    const normalized = profileIds.map((profileId) => profileId.trim());
    if (new Set(normalized).size !== normalized.length) {
      throw new Error("TELEGRAM_USER_PROFILE_ACCESS contains duplicate profiles");
    }
    access[userId] = normalized;
  }
  return access;
};
