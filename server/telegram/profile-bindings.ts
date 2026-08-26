import type { LanguageCode } from "../../contracts/api.js";
import type { ProfileContext, ProfileId } from "../profiles/manager.js";
import {
  readTelegramBindings,
  writeTelegramBindings,
  type TelegramBinding,
} from "./bindings.js";

export class ProfileTelegramBindings {
  private readonly telegramProfiles = new Map<string, ProfileId>();

  constructor(private readonly contexts: Map<ProfileId, ProfileContext>) {
    for (const [profileId, context] of contexts) {
      for (const binding of readTelegramBindings(context.db)) {
        const existing = this.telegramProfiles.get(binding.userId);
        if (existing && existing !== profileId) throw new Error("TELEGRAM_ID_BOUND_TO_MULTIPLE_PROFILES");
        this.telegramProfiles.set(binding.userId, profileId);
      }
    }
  }

  get(userId: string) {
    const profileId = this.telegramProfiles.get(userId);
    if (!profileId) return null;
    const binding = readTelegramBindings(this.context(profileId).db).find((candidate) => candidate.userId === userId);
    if (!binding) {
      this.telegramProfiles.delete(userId);
      return null;
    }
    return { profileId, binding };
  }

  list(profileId: ProfileId) {
    return readTelegramBindings(this.context(profileId).db);
  }

  bind(input: { profileId: ProfileId; userId: string; chatId: string; language: LanguageCode }) {
    const existingProfileId = this.telegramProfiles.get(input.userId);
    if (existingProfileId && existingProfileId !== input.profileId) throw new Error("TELEGRAM_ID_ALREADY_BOUND");
    const context = this.context(input.profileId);
    const bindings = readTelegramBindings(context.db);
    const existing = bindings.find((binding) => binding.userId === input.userId);
    if (existing) {
      existing.chatId = input.chatId;
      writeTelegramBindings(context.db, bindings);
      return { ...existing };
    }
    const binding: TelegramBinding = {
      userId: input.userId,
      chatId: input.chatId,
      language: input.language,
      mode: "notebook",
      tutorThreadId: null,
    };
    writeTelegramBindings(context.db, [...bindings, binding]);
    this.telegramProfiles.set(input.userId, input.profileId);
    return { ...binding };
  }

  update(userId: string, changes: Partial<Omit<TelegramBinding, "userId">>) {
    const found = this.get(userId);
    if (!found) return null;
    const context = this.context(found.profileId);
    const bindings = readTelegramBindings(context.db);
    const index = bindings.findIndex((binding) => binding.userId === userId);
    if (index < 0) return null;
    bindings[index] = { ...bindings[index], ...changes, userId };
    writeTelegramBindings(context.db, bindings);
    return { profileId: found.profileId, binding: { ...bindings[index] } };
  }

  unbind(profileId: ProfileId, userId: string) {
    const context = this.context(profileId);
    const bindings = readTelegramBindings(context.db);
    const remaining = bindings.filter((binding) => binding.userId !== userId);
    if (remaining.length === bindings.length) return false;
    writeTelegramBindings(context.db, remaining);
    this.telegramProfiles.delete(userId);
    return true;
  }

  private context(profileId: ProfileId) {
    const context = this.contexts.get(profileId);
    if (!context) throw new Error(`Profile is unavailable: ${profileId}`);
    return context;
  }
}
