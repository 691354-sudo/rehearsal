import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const profileBackupDir = path.join(config.backupDir, "profiles");
fs.mkdirSync(profileBackupDir, { recursive: true });
const profilesDir = path.join(config.dataDir, "profiles");
const baseRegistryPath = path.join(profilesDir, "registry.json");
const additionalRegistryPath = path.join(profilesDir, "additional-registry.json");
const additionalRegistry = fs.existsSync(additionalRegistryPath)
  ? JSON.parse(fs.readFileSync(additionalRegistryPath, "utf8")) as {
      state: "initializing" | "ready"; profile: { id: string };
    }
  : null;
const registeredProfileIds = fs.existsSync(baseRegistryPath)
  ? [
      ...(JSON.parse(fs.readFileSync(baseRegistryPath, "utf8")) as { profiles: Array<{ id: string }> }).profiles,
      ...(additionalRegistry?.state === "ready"
        || (additionalRegistry && fs.existsSync(path.join(profilesDir, `${additionalRegistry.profile.id}.sqlite`)))
        ? [additionalRegistry.profile]
        : []),
    ].map((profile) => profile.id)
  : [];
const profileSources = registeredProfileIds.map((profileId) => ({
  profileId,
  source: path.join(profilesDir, `${profileId}.sqlite`),
}));

if (!profileSources.length) {
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
  const missing = profileSources.filter(({ source }) => !fs.existsSync(source));
  if (missing.length) throw new Error(`Registered profile database is missing: ${missing.map(({ profileId }) => profileId).join(", ")}`);
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
