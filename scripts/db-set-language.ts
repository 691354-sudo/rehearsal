import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { isLanguageCode } from "../contracts/api.js";
import { config } from "../server/config.js";
import { openDatabase } from "../server/db/database.js";
import { RehearsalRepository } from "../server/db/repository.js";
import { profileIds, type ProfileId } from "../server/profiles/manager.js";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const profile = argument("--profile") as ProfileId | undefined;
const language = argument("--language");
const enabledValue = argument("--enabled");
const dryRun = process.argv.includes("--dry-run");

if (!profile || !profileIds.includes(profile) || !isLanguageCode(language)
  || !["true", "false"].includes(enabledValue || "")) {
  console.error(
    "Usage: npm run db:set-language -- --profile oliver --language vi --enabled true [--dry-run]",
  );
  process.exit(1);
}

const enabled = enabledValue === "true";
const databasePath = path.join(config.dataDir, "profiles", `${profile}.sqlite`);
if (!fs.existsSync(databasePath)) throw new Error(`Profile database does not exist: ${profile}`);
const db = dryRun ? new Database(databasePath, { readonly: true }) : openDatabase(databasePath);
const repository = new RehearsalRepository(db);

try {
  if (dryRun) {
    const columns = db.prepare("PRAGMA table_info(languages)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "enabled")) {
      throw new Error("Language availability migration has not been applied; deploy the application first");
    }
  }
  const before = repository.system.listLanguages(false).find((option) => option.code === language);
  if (!before) throw new Error(`Unknown language: ${language}`);
  const cardCount = db.prepare("SELECT COUNT(*) AS count FROM items WHERE language_code = ?")
    .get(language) as { count: number };
  const preview = { profile, language, before: repository.system.isLanguageEnabled(language), enabled, cards: cardCount.count };
  if (dryRun) {
    console.log(JSON.stringify({ ...preview, dryRun: true }));
  } else {
    const expected = `${profile}:${language}:${enabled}`;
    if (process.env.CONFIRM_LANGUAGE_CHANGE !== expected) {
      throw new Error(`Set CONFIRM_LANGUAGE_CHANGE=${expected} to change language availability`);
    }
    repository.system.setLanguageEnabled(language, enabled);
    const foreignKeys = db.pragma("foreign_key_check") as unknown[];
    const quickCheck = db.pragma("quick_check", { simple: true });
    if (foreignKeys.length) throw new Error("SQLite foreign_key_check failed after language update");
    if (quickCheck !== "ok") throw new Error("SQLite quick_check failed after language update");
    console.log(JSON.stringify({ ...preview, foreignKeyCheck: "ok", quickCheck }));
  }
} finally {
  db.close();
}
