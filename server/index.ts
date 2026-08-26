import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { seedDatabase } from "./db/seed.js";
import { ProfileManager, profileIds } from "./profiles/manager.js";
import { shouldServeAppShell } from "./static-shell.js";
import { TelegramEchoBot } from "./telegram/bot.js";
import { TelegramHttpClient } from "./telegram/client.js";
import { TelegramPollingRuntime } from "./telegram/polling.js";

const profiles = await ProfileManager.create({
  dataDir: config.dataDir,
  backupDir: config.backupDir,
  legacyDatabasePath: config.databasePath,
  pins: { roman: config.romanProfilePin, oliver: config.oliverProfilePin, zanna: config.zannaProfilePin },
});

for (const profileId of profileIds) {
  const repository = profiles.get(profileId).repository;
  if (profileId !== "zanna" && !repository.items.list("en", 1).length && !repository.items.list("lv", 1).length) {
    seedDatabase(repository);
  }
}

const app = await buildApp(profiles);
let telegram: TelegramPollingRuntime | null = null;
const distPath = path.resolve(process.cwd(), "dist");

if (fs.existsSync(distPath)) {
  await app.register(fastifyStatic, { root: distPath });
  app.setNotFoundHandler((request, reply) => {
    if (!shouldServeAppShell({
      method: request.method,
      url: request.url,
      accept: request.headers.accept,
    })) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });
}

const shutdown = async () => {
  await telegram?.stop();
  await app.close();
  profiles.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: config.host, port: config.port });
app.log.info(`Rehearsal API ready at http://${config.host}:${config.port}`);

if (config.telegramBotToken) {
  if (!config.telegramAllowedProfileIds.length) {
    throw new Error("TELEGRAM_ALLOWED_PROFILE_IDS is required when Telegram polling is enabled");
  }
  if (!config.telegramAllowedUserIds.length) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS is required when Telegram polling is enabled");
  }
  if (config.telegramAllowedUserIds.some((userId) => !/^\d{1,20}$/.test(userId))) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS contains an invalid Telegram user ID");
  }
  for (const userId of config.telegramAllowedUserIds) {
    if (!config.telegramUserProfileAccess[userId]?.length) {
      throw new Error(`Telegram profile access is missing for user: ${userId}`);
    }
  }
  for (const [userId, allowedProfileIds] of Object.entries(config.telegramUserProfileAccess)) {
    if (!config.telegramAllowedUserIds.includes(userId)) {
      throw new Error(`Telegram profile access contains a user outside the allowlist: ${userId}`);
    }
    if (allowedProfileIds.some((profileId) => !config.telegramAllowedProfileIds.includes(profileId))) {
      throw new Error(`Telegram profile access exceeds the profile allowlist for user: ${userId}`);
    }
  }
  for (const profileId of config.telegramAllowedProfileIds) {
    if (!profiles.hasProfile(profileId)) throw new Error(`Telegram profile is unavailable: ${profileId}`);
  }
  if (!/^https:\/\//.test(config.telegramMiniAppUrl)) {
    throw new Error("TELEGRAM_MINI_APP_URL must be an HTTPS URL when Telegram polling is enabled");
  }
  const telegramClient = new TelegramHttpClient(config.telegramBotToken);
  const telegramBot = new TelegramEchoBot(
    profiles,
    telegramClient,
    config.telegramMiniAppUrl,
    config.telegramAllowedProfileIds,
    config.telegramAllowedUserIds,
    config.telegramUserProfileAccess,
  );
  telegram = new TelegramPollingRuntime(telegramClient, telegramBot, config.telegramMiniAppUrl);
  await telegram.start();
  app.log.info("Telegram bot polling started");
}
