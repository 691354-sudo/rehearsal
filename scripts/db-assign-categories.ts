import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { registeredProfilesFromDisk } from "../server/profiles/manager.js";
import { applyCategoryAssignments, categoryAssignmentSchema, previewCategoryAssignments } from "../server/db/category-assignments.js";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const profileId = argument("--profile");
const inputPath = argument("--input");
const dryRun = process.argv.includes("--dry-run");
const profile = registeredProfilesFromDisk(config.dataDir).find((entry) => entry.id === profileId);
if (!profile || !inputPath || !path.isAbsolute(inputPath)) {
  throw new Error("Usage: npm run db:assign-categories -- --profile <profile> --input /absolute/path/assignments.json [--dry-run]");
}
const plan = categoryAssignmentSchema.parse(JSON.parse(fs.readFileSync(inputPath, "utf8")));
const db = new Database(profile.databasePath, { readonly: dryRun, fileMustExist: true });
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
try {
  const preview = previewCategoryAssignments(db, plan);
  const confirmation = `${profile.id}:${preview.hash.slice(0, 12)}`;
  if (dryRun || preview.applied) {
    console.log(JSON.stringify({ profile: profile.id, ...preview, confirmation }));
  } else {
    if (process.env.CONFIRM_CATEGORY_ASSIGNMENT !== confirmation) throw new Error(`Set CONFIRM_CATEGORY_ASSIGNMENT=${confirmation} after reviewing the assignments`);
    const backupDir = path.join(config.backupDir, "profiles");
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `${profile.id}-pre-categories-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
    await db.backup(backup);
    fs.chmodSync(backup, 0o600);
    const check = new Database(backup, { readonly: true });
    try {
      if (check.pragma("quick_check", { simple: true }) !== "ok" || (check.pragma("foreign_key_check") as unknown[]).length) throw new Error("Category backup verification failed");
    } finally { check.close(); }
    console.log(JSON.stringify({ profile: profile.id, backup, ...applyCategoryAssignments(db, plan) }));
  }
} finally { db.close(); }
