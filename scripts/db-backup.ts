import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { profileIds } from "../server/profiles/manager.js";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const profileBackupDir = path.join(config.backupDir, "profiles");
fs.mkdirSync(profileBackupDir, { recursive: true });
const profileSources = profileIds.map((profileId) => ({
  profileId,
  source: path.join(config.dataDir, "profiles", `${profileId}.sqlite`),
}));

if (profileSources.some(({ source }) => !fs.existsSync(source))) {
  if (!fs.existsSync(config.databasePath)) throw new Error("Neither profile nor legacy database exists");
  const destination = path.join(config.backupDir, `legacy-pre-profile-${stamp}.sqlite`);
  const db = new Database(config.databasePath);
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
  console.log(`Legacy pre-profile backup created: ${destination} (${fs.statSync(destination).size} bytes)`);
} else {
  for (const { profileId, source } of profileSources) {
    const destination = path.join(profileBackupDir, `${profileId}-${stamp}.sqlite`);
    const db = new Database(source);
    try {
      await db.backup(destination);
    } finally {
      db.close();
    }
    const checkDb = new Database(destination, { readonly: true });
    const check = checkDb.pragma("quick_check") as Array<{ quick_check: string }>;
    checkDb.close();
    if (check[0]?.quick_check !== "ok") throw new Error(`Backup quick_check failed: ${profileId}`);
    console.log(`Backup created for ${profileId}: ${destination} (${fs.statSync(destination).size} bytes)`);
  }
}
