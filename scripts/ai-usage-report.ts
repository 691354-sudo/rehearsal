import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { AiUsageRepository } from "../server/db/repositories/ai-usage.js";
import type { RehearsalDatabase } from "../server/db/database.js";
import { registeredProfilesFromDisk } from "../server/profiles/manager.js";
import {
  diagnoseAiUsage,
  reportTableRows,
  type ProfileAiUsageSummary,
} from "../server/services/ai-usage-report.js";

const args = process.argv.slice(2);
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const days = Number(valueAfter("--days") || 30);
const selectedProfile = valueAfter("--profile") || "all";
const json = args.includes("--json");
if (!Number.isInteger(days) || days < 1 || days > 3_650) {
  throw new Error("--days must be an integer from 1 to 3650");
}

const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
const profiles = registeredProfilesFromDisk(config.dataDir)
  .filter((profile) => selectedProfile === "all" || profile.id === selectedProfile);
if (!profiles.length) throw new Error(`No registered profile matched: ${selectedProfile}`);

const rows: ProfileAiUsageSummary[] = [];
for (const profile of profiles) {
  const db = new Database(profile.databasePath, { readonly: true });
  try {
    const table = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_usage_events'",
    ).get();
    if (!table) continue;
    rows.push(...new AiUsageRepository(db as RehearsalDatabase).summarize(since).map((row) => ({
      ...row, profileId: profile.id, profileName: profile.name,
    })));
  } finally {
    db.close();
  }
}

const signals = diagnoseAiUsage(rows);
if (json) {
  console.log(JSON.stringify({ since: since.toISOString(), days, rows, signals }, null, 2));
} else {
  console.log(`AI usage since ${since.toISOString()} (${days} days)`);
  console.table(reportTableRows(rows));
  console.log("Signals:");
  for (const signal of signals) console.log(`- ${signal}`);
  console.log("USD is intentionally omitted: reconcile these exact units with current provider billing rates.");
}
