import { openAIConfigured, config } from "../config.js";
import { openDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";
import { OpenAIService } from "../services/openai.js";

if (!openAIConfigured) {
  console.error("OPENAI_API_KEY is required to generate embeddings.");
  process.exit(1);
}

const db = openDatabase();
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
