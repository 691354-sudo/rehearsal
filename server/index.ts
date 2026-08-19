import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { seedDatabase } from "./db/seed.js";
import { ProfileManager, profileIds } from "./profiles/manager.js";

const profiles = await ProfileManager.create({
  dataDir: config.dataDir,
  backupDir: config.backupDir,
  legacyDatabasePath: config.databasePath,
  pins: { roman: config.romanProfilePin, oliver: config.oliverProfilePin },
});

for (const profileId of profileIds) {
  const repository = profiles.get(profileId).repository;
  if (!repository.items.list("en", 1).length && !repository.items.list("lv", 1).length) {
    seedDatabase(repository);
  }
}

const app = await buildApp(profiles);
const distPath = path.resolve(process.cwd(), "dist");

if (fs.existsSync(distPath)) {
  await app.register(fastifyStatic, { root: distPath });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api") || request.url === "/health") {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });
}

const shutdown = async () => {
  await app.close();
  profiles.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: config.host, port: config.port });
app.log.info(`Rehearsal API ready at http://${config.host}:${config.port}`);
