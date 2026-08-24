import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { openDatabase } from "../server/db/database.js";
import { RehearsalRepository } from "../server/db/repository.js";
import { registeredProfilesFromDisk, type ProfileId } from "../server/profiles/manager.js";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const profile = argument("--profile") as ProfileId | undefined;
const dryRun = process.argv.includes("--dry-run");
const registeredProfile = registeredProfilesFromDisk(config.dataDir).find((candidate) => candidate.id === profile);

if (!profile || !registeredProfile) {
  console.error("Usage: npm run db:delete-orphans -- --profile roman [--dry-run]");
  process.exit(1);
}

const databasePath = registeredProfile.databasePath;
if (!fs.existsSync(databasePath)) throw new Error(`Profile database does not exist: ${profile}`);
const db = dryRun ? new Database(databasePath, { readonly: true }) : openDatabase(databasePath);
const orphanItems = () => db.prepare(
  `SELECT items.public_id AS publicId, items.language_code AS language, items.target
   FROM items
   LEFT JOIN island_items ON island_items.item_id = items.id
   WHERE island_items.item_id IS NULL
   ORDER BY items.language_code, items.created_at, items.id`,
).all() as Array<{ publicId: string; language: string; target: string }>;

try {
  const items = orphanItems();
  const preview = { profile, count: items.length, items };
  if (dryRun || !items.length) {
    console.log(JSON.stringify({ ...preview, dryRun }));
  } else {
    const expected = `${profile}:${items.length}`;
    if (process.env.CONFIRM_DELETE_ORPHANS !== expected) {
      throw new Error(`Set CONFIRM_DELETE_ORPHANS=${expected} to delete these cards`);
    }
    const repository = new RehearsalRepository(db);
    const deleted = repository.items.deleteMany(items.map((item) => item.publicId));
    if (!deleted || orphanItems().length) throw new Error("Orphan card deletion did not complete");
    const foreignKeys = db.pragma("foreign_key_check") as unknown[];
    const quickCheck = db.pragma("quick_check", { simple: true });
    if (foreignKeys.length) throw new Error("SQLite foreign_key_check failed after orphan deletion");
    if (quickCheck !== "ok") throw new Error("SQLite quick_check failed after orphan deletion");
    console.log(JSON.stringify({ ...preview, deleted: deleted.length, foreignKeyCheck: "ok", quickCheck }));
  }
} finally {
  db.close();
}
