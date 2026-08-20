import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { openDatabase } from "../server/db/database.js";
import { libraryReplacementSchema, replaceLibrary } from "../server/db/library-replacement.js";
import { profileIds, type ProfileId } from "../server/profiles/manager.js";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const profile = argument("--profile") as ProfileId | undefined;
const inputPath = argument("--input");
const dryRun = process.argv.includes("--dry-run");

if (!profile || !profileIds.includes(profile) || !inputPath || !path.isAbsolute(inputPath)) {
  console.error("Usage: npm run db:replace-library -- --profile roman --input /absolute/path/import.json [--dry-run]");
  process.exit(1);
}
const databasePath = path.join(config.dataDir, "profiles", `${profile}.sqlite`);
if (!fs.existsSync(databasePath)) throw new Error(`Profile database does not exist: ${profile}`);
const input = libraryReplacementSchema.parse(JSON.parse(fs.readFileSync(inputPath, "utf8")));
const db = openDatabase(databasePath);

try {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM items WHERE language_code = ?")
    .get(input.language) as { count: number };
  if (dryRun) {
    console.log(JSON.stringify({ profile, language: input.language, existing: existing.count, replacement: input.cards.length }));
  } else {
    const expected = `${profile}:${input.language}`;
    if (process.env.CONFIRM_REPLACE_LIBRARY !== expected) {
      throw new Error(`Set CONFIRM_REPLACE_LIBRARY=${expected} to replace this Library`);
    }
    const result = replaceLibrary(db, input);
    const quickCheck = db.pragma("quick_check", { simple: true });
    if (quickCheck !== "ok") throw new Error("SQLite quick_check failed after Library replacement");
    console.log(JSON.stringify({ profile, language: input.language, ...result, quickCheck }));
  }
} finally {
  db.close();
}
