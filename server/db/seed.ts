import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";
import { seedItems } from "../data/seed-content.js";
import { config } from "../config.js";
import { registeredProfilesFromDisk } from "../profiles/manager.js";

export const seedDatabase = (repository: RehearsalRepository) => {
  seedItems.forEach((item) => repository.items.save(item, "system"));
  return seedItems.length;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profileFlagIndex = process.argv.indexOf("--profile");
  const profileArgument = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : undefined;
  const registeredProfile = registeredProfilesFromDisk(config.dataDir)
    .find((profile) => profile.id === profileArgument);
  if (!profileArgument || !registeredProfile) {
    console.error("Usage: npm run db:seed -- --profile roman");
    process.exit(1);
  }
  const databasePath = registeredProfile.databasePath;
  const db = openDatabase(databasePath);
  const repository = new RehearsalRepository(db);
  const count = seedDatabase(repository);
  console.log(`Seeded ${count} curated learning items for ${profileArgument}.`);
  db.close();
}
