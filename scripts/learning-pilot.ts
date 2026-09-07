import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../server/config.js";
import { openDatabase, type RehearsalDatabase } from "../server/db/database.js";
import { RehearsalRepository } from "../server/db/repository.js";
import { registeredProfilesFromDisk } from "../server/profiles/manager.js";
import { pilotMetrics } from "../server/services/pilot-metrics.js";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const value = (name: string) => args.includes(name) ? option(name) : undefined;
const command = args[0];
const profileId = value("--profile");
if (!["start", "end", "export"].includes(command) || !profileId) {
  throw new Error("Usage: npm run pilot -- start|end|export --profile ID [--timezone Europe/Riga] [--output file.json]");
}
const profile = registeredProfilesFromDisk(config.dataDir).find((entry) => entry.id === profileId);
if (!profile) throw new Error("Profile not found in the registered profile store");
const db = command === "export" ? new Database(profile.databasePath, { readonly: true }) as RehearsalDatabase
  : openDatabase(profile.databasePath);
try {
  const repository = new RehearsalRepository(db);
  const pilot = repository.pilot;
  let result: unknown;
  if (command === "start") {
    const timezone = value("--timezone");
    if (!timezone) throw new Error("Starting observation requires --timezone; tell the tester that learning events and feedback are recorded.");
    result = pilot.participants.start(timezone);
  } else if (command === "end") {
    const participant = pilot.participants.list().find((entry) => entry.endedAt === null);
    if (!participant) throw new Error("No active observation window for this profile");
    result = pilot.participants.end(participant.participantId);
  } else {
    const participant = pilot.participants.list().at(-1);
    const from = value("--from") ?? participant?.startedAt;
    const until = value("--to") ?? participant?.endedAt ?? new Date().toISOString();
    if (!from || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(until))) {
      throw new Error("Export requires an enrolled participant or explicit --from and --to UTC dates");
    }
    if (!db.prepare("SELECT 1 FROM app_settings WHERE key = 'pilot_user_id'").get()) {
      throw new Error("This profile has no pilot actions or observation window yet");
    }
    const report = pilot.export.report(new Date(from).toISOString(), new Date(until).toISOString(), participant?.timezone);
    result = { ...report, metrics: pilotMetrics(report) };
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const output = value("--output");
  if (output) {
    const destination = path.resolve(output);
    fs.writeFileSync(destination, json, { mode: 0o600, flag: "wx" });
    console.log(`Saved ${Buffer.byteLength(json)} bytes to ${destination}`);
  } else console.log(json);
} finally { db.close(); }
