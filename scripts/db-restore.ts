import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";

const sourceArgument = process.argv[2];
if (!sourceArgument) {
  console.error("Usage: CONFIRM_RESTORE=1 npm run db:restore -- /absolute/path/to/backup.sqlite");
  process.exit(1);
}
if (process.env.CONFIRM_RESTORE !== "1") {
  console.error("Restore refused. Set CONFIRM_RESTORE=1 after stopping the API server.");
  process.exit(1);
}

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

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.backupDir, { recursive: true });
if (fs.existsSync(config.databasePath)) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const safetyCopy = path.join(config.backupDir, `pre-restore-${stamp}.sqlite`);
  fs.copyFileSync(config.databasePath, safetyCopy);
  console.log(`Current database preserved at: ${safetyCopy}`);
}
fs.copyFileSync(source, config.databasePath);
console.log(`Database restored from: ${source}`);
