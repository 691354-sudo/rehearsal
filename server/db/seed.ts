import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";
import { seedItems } from "../data/seed-content.js";
import { config } from "../config.js";
import { profileIds, type ProfileId } from "../profiles/manager.js";

export const seedDatabase = (repository: RehearsalRepository) => {
  const sourceFiles = [
    {
      publicId: "source-vocabulary-list",
      title: "Roman's vocabulary list",
      path: "/Users/working/.codex/attachments/27d2d7c8-c912-4496-8e1c-9c1bd6db8144/pasted-text.txt",
      kind: "vocabulary",
    },
    {
      publicId: "source-topic-phrases",
      title: "Roman's topic phrases and islands",
      path: "/Users/working/.codex/attachments/19083610-d573-4c04-a2b2-20179b510a07/pasted-text.txt",
      kind: "phrases",
    },
    {
      publicId: "source-method-45-minutes",
      title: "45-minute language learning method transcript",
      path: "/Users/working/.codex/attachments/7b2a6434-a3c8-4a3b-9839-b5505fc83872/pasted-text.txt",
      kind: "method",
    },
    {
      publicId: "source-method-language-islands",
      title: "Language islands and shadowing method transcript",
      path: "/Users/working/.codex/attachments/83cbb4d4-6365-4f36-a371-cf5cf3f9cd38/pasted-text.txt",
      kind: "method",
    },
  ];
  sourceFiles.forEach((source) => {
    if (!fs.existsSync(source.path)) return;
    repository.library.saveSource({
      publicId: source.publicId,
      language: "en",
      title: source.title,
      rawText: fs.readFileSync(source.path, "utf8"),
      kind: source.kind,
      metadata: { importedFrom: "user attachment", curatedIntoSeed: true },
    });
  });
  seedItems.forEach((item) => repository.items.save(item, "system"));
  return seedItems.length;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profileFlagIndex = process.argv.indexOf("--profile");
  const profileArgument = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : undefined;
  if (!profileArgument || !profileIds.includes(profileArgument as ProfileId)) {
    console.error("Usage: npm run db:seed -- --profile roman");
    process.exit(1);
  }
  const databasePath = path.join(config.dataDir, "profiles", `${profileArgument}.sqlite`);
  const db = openDatabase(databasePath);
  const repository = new RehearsalRepository(db);
  const count = seedDatabase(repository);
  console.log(`Seeded ${count} curated learning items for ${profileArgument}.`);
  db.close();
}
import fs from "node:fs";
