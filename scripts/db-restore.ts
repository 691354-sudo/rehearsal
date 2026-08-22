import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { registeredProfilesFromDisk, type ProfileId } from "../server/profiles/manager.js";

const profileFlagIndex = process.argv.indexOf("--profile");
const profileArgument = profileFlagIndex >= 0 ? process.argv[profileFlagIndex + 1] : undefined;
const sourceArgument = process.argv.find((argument, index) =>
  index > 1 && index !== profileFlagIndex && index !== profileFlagIndex + 1 && !argument.startsWith("--"));

const registeredProfile = registeredProfilesFromDisk(config.dataDir)
  .find((profile) => profile.id === profileArgument);
if (!profileArgument || !registeredProfile || !sourceArgument) {
  console.error("Usage: CONFIRM_RESTORE=1 npm run db:restore -- --profile roman /absolute/path/to/backup.sqlite");
  process.exit(1);
}
if (process.env.CONFIRM_RESTORE !== "1") {
  console.error("Restore refused. Set CONFIRM_RESTORE=1 after stopping the API server.");
  process.exit(1);
}

const profileId = profileArgument as ProfileId;
const source = path.resolve(sourceArgument);
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
  console.error(`Backup file not found: ${source}`);
  process.exit(1);
}

const candidate = new Database(source, { readonly: true });
const check = candidate.pragma("quick_check") as Array<{ quick_check: string }>;
candidate.close();
if (check[0]?.quick_check !== "ok") {
  console.error("Restore refused: SQLite quick_check failed.");
  process.exit(1);
}

const destination = registeredProfile.databasePath;
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.mkdirSync(config.backupDir, { recursive: true });
if (fs.existsSync(destination)) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const safetyCopy = path.join(config.backupDir, `pre-restore-${profileId}-${stamp}.sqlite`);
  fs.copyFileSync(destination, safetyCopy);
  console.log(`Current ${profileId} database preserved at: ${safetyCopy}`);
}
fs.copyFileSync(source, destination);
console.log(`Database restored for ${profileId} from: ${source}`);
