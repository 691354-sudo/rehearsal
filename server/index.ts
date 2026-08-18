import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { openDatabase } from "./db/database.js";
import { RehearsalRepository } from "./db/repository.js";
import { seedDatabase } from "./db/seed.js";

const db = openDatabase();
const repository = new RehearsalRepository(db);
if (!repository.listItems("en", 1).length && !repository.listItems("lv", 1).length) {
  seedDatabase(repository);
}

const app = await buildApp(repository);
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
  db.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: config.host, port: config.port });
app.log.info(`Rehearsal API ready at http://${config.host}:${config.port}`);
