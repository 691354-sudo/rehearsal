import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { openDatabase } from "../server/db/database.js";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
fs.mkdirSync(config.backupDir, { recursive: true });
const destination = path.join(config.backupDir, `rehearsal-${stamp}.sqlite`);

const db = openDatabase();
await db.backup(destination);
db.close();

const size = fs.statSync(destination).size;
console.log(`Backup created: ${destination} (${size} bytes)`);
