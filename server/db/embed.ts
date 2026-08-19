import fs from "node:fs";
import path from "node:path";
import { openAIConfigured, config } from "../config.js";
import { openDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";
import { profileIds, type ProfileId } from "../profiles/manager.js";
import { OpenAIService } from "../services/openai.js";

if (!openAIConfigured) {
  console.error("OPENAI_API_KEY is required to generate embeddings.");
  process.exit(1);
}

const profileFlagIndex = process.argv.indexOf("--profile");
const profileArgument = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : undefined;
if (!profileArgument || !profileIds.includes(profileArgument as ProfileId)) {
  console.error("Usage: npm run db:embed -- --profile roman");
  process.exit(1);
}
const databasePath = path.join(config.dataDir, "profiles", `${profileArgument}.sqlite`);
if (!fs.existsSync(databasePath)) {
  console.error(`Profile database does not exist: ${profileArgument}`);
  process.exit(1);
}

const db = openDatabase(databasePath);
const repository = new RehearsalRepository(db);
const openai = new OpenAIService(repository);
let embedded = 0;

while (true) {
  const items = repository.items.missingEmbeddings(50);
  if (!items.length) break;
  for (const item of items) {
    const vector = await openai.embed([item.target, item.cue, item.note, item.tags.join(" ")].join("\n"));
    if (!vector) throw new Error("Embedding request returned no vector");
    repository.items.updateEmbedding(item.publicId, vector, config.embeddingModel);
    embedded += 1;
    console.log(`Embedded ${embedded}: ${item.target}`);
  }
}

db.close();
console.log(`Embedding index is up to date. Added ${embedded} vectors.`);
