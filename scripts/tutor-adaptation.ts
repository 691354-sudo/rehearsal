import fs from "node:fs";
import Database from "better-sqlite3";
import { isLanguageCode } from "../contracts/api.js";
import { tutorModeSchema, tutorOverridesSchema } from "../contracts/tutor-adaptation.js";
import { config } from "../server/config.js";
import { RehearsalRepository } from "../server/db/repository.js";
import type { RehearsalDatabase } from "../server/db/database.js";
import { registeredProfilesFromDisk } from "../server/profiles/manager.js";
import { effectiveTutorSettings, TUTOR_CONFIG_VERSION } from "../server/services/tutor-mode-config.js";

const arg = (flag: string) => { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1]; };
const selected = arg("--profile"); const language = arg("--language");
const enabled = arg("--enabled"); const mode = arg("--mode"); const overrides = arg("--overrides");
const reset = process.argv.includes("--reset-overrides"); const apply = process.argv.includes("--apply");
const mutating = enabled !== undefined || mode !== undefined || overrides !== undefined || reset;
if (!selected || (enabled === undefined && !isLanguageCode(language)) || (enabled !== undefined && !["true", "false"].includes(enabled))) {
  throw new Error("Usage: npm run tutor:adaptation -- --profile <user_id|all> [--language en] [--mode beginner|intermediate|advanced] [--overrides '<JSON>'] [--reset-overrides] [--enabled true|false] [--apply]");
}
if (selected === "all" && enabled === undefined && mutating) throw new Error("Select one user_id to change individual support settings.");
const profiles = registeredProfilesFromDisk(config.dataDir).filter((profile) => selected === "all" || profile.id === selected);
if (!profiles.length) throw new Error("No registered profile matched the supplied user_id.");
const patch = { ...(mode ? { mode: tutorModeSchema.parse(mode) } : {}), ...(overrides ? { overrides: tutorOverridesSchema.parse(JSON.parse(overrides)) } : {}), ...(reset ? { resetOverrides: true } : {}) };
if (Object.keys(patch).length && !isLanguageCode(language)) throw new Error("Individual support settings require --language.");
for (const profile of profiles) {
  if (!fs.existsSync(profile.databasePath)) throw new Error(`Missing profile database: ${profile.id}`);
  // Never run migrations as an administration side effect.
  const db = new Database(profile.databasePath, { readonly: !apply || !mutating });
  try {
    const repository = new RehearsalRepository(db as RehearsalDatabase);
    const a = repository.tutor.adaptation;
    if (apply && mutating) {
      if (enabled !== undefined) a.setEnabled(enabled === "true");
      if (isLanguageCode(language) && Object.keys(patch).length) a.update(language, "ru", patch, "operator");
    }
    const saved = isLanguageCode(language) ? a.get(language) : null;
    console.log(JSON.stringify({ userId: profile.id, language, enabled: a.enabled(), mode: saved?.interactionMode || "intermediate",
      overrides: saved?.customTutorSettings || {}, settings: effectiveTutorSettings(saved), configVersion: TUTOR_CONFIG_VERSION,
      ...(mutating && !apply ? { preview: { enabled, ...patch }, applyRequired: true } : {}) }));
  } finally { db.close(); }
}
