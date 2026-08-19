import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";

export const profileIds = ["roman", "oliver"] as const;
export type ProfileId = typeof profileIds[number];

type ProfileRecord = {
  id: ProfileId;
  name: string;
  databasePath: string;
  pinSalt: string;
  pinHash: string;
};

type ProfileRegistry = {
  version: 1;
  profiles: ProfileRecord[];
};

export type ProfileContext = {
  id: ProfileId;
  name: string;
  databasePath: string;
  db: RehearsalDatabase;
  repository: RehearsalRepository;
};

export type ProfileManagerOptions = {
  dataDir: string;
  backupDir: string;
  legacyDatabasePath: string;
  pins: Record<ProfileId, string>;
};

const pinPattern = /^\d{6,12}$/;
const registryName = "registry.json";
const migrationReportName = "migration.json";

const writePrivateJson = (destination: string, value: unknown) => {
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  fs.chmodSync(destination, 0o600);
};

const tableCounts = (db: Database.Database) => {
  const tables = [
    "languages", "sources", "items", "items_fts", "islands", "island_items",
    "attempts", "review_state", "chat_threads", "chat_messages", "review_batches",
    "change_events", "app_settings", "audio_cache", "capture_notes",
  ];
  return Object.fromEntries(tables.map((table) => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    return [table, row.count];
  }));
};

const assertHealthyCopy = (databasePath: string, expected: Record<string, number>) => {
  const db = new Database(databasePath, { readonly: true });
  try {
    const check = db.pragma("quick_check") as Array<{ quick_check: string }>;
    if (check[0]?.quick_check !== "ok") throw new Error(`SQLite quick_check failed for ${databasePath}`);
    const actual = tableCounts(db);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Profile database counts do not match the migration source: ${databasePath}`);
    }
  } finally {
    db.close();
  }
};

const createRegistry = (profilesDir: string, pins: Record<ProfileId, string>): ProfileRegistry => ({
  version: 1,
  profiles: profileIds.map((id) => {
    const pin = pins[id];
    if (!pinPattern.test(pin)) throw new Error(`${id.toUpperCase()}_PROFILE_PIN must contain 6-12 digits`);
    const salt = randomBytes(16);
    return {
      id,
      name: id === "roman" ? "Roman" : "Oliver",
      databasePath: path.join(profilesDir, `${id}.sqlite`),
      pinSalt: salt.toString("base64"),
      pinHash: scryptSync(pin, salt, 64).toString("base64"),
    };
  }),
});

const readRegistry = (registryPath: string): ProfileRegistry => {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as ProfileRegistry;
  if (parsed.version !== 1 || parsed.profiles.length !== profileIds.length) {
    throw new Error("Unsupported or incomplete profile registry");
  }
  for (const id of profileIds) {
    const profile = parsed.profiles.find((candidate) => candidate.id === id);
    if (!profile || path.basename(profile.databasePath) !== `${id}.sqlite`) {
      throw new Error(`Invalid ${id} profile registry entry`);
    }
  }
  return parsed;
};

const migrateLegacyDatabase = async (
  options: ProfileManagerOptions,
  registry: ProfileRegistry,
) => {
  const missing = registry.profiles.filter((profile) => !fs.existsSync(profile.databasePath));
  if (!missing.length) return;

  if (!fs.existsSync(options.legacyDatabasePath)) {
    for (const profile of missing) openDatabase(profile.databasePath).close();
    return;
  }

  fs.mkdirSync(options.backupDir, { recursive: true });
  const source = openDatabase(options.legacyDatabasePath);
  try {
    const expected = tableCounts(source);
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const archivePath = path.join(options.backupDir, `legacy-before-profiles-${stamp}.sqlite`);
    await source.backup(archivePath);
    assertHealthyCopy(archivePath, expected);

    for (const profile of missing) {
      await source.backup(profile.databasePath);
      assertHealthyCopy(profile.databasePath, expected);
    }

    writePrivateJson(path.join(path.dirname(registry.profiles[0].databasePath), migrationReportName), {
      migratedAt: new Date().toISOString(),
      source: options.legacyDatabasePath,
      archive: archivePath,
      profiles: missing.map((profile) => profile.id),
      counts: expected,
    });
  } finally {
    source.close();
  }
};

export class ProfileManager {
  private readonly contexts = new Map<ProfileId, ProfileContext>();

  private constructor(private readonly registry: ProfileRegistry) {
    for (const profile of registry.profiles) {
      const db = openDatabase(profile.databasePath);
      this.contexts.set(profile.id, {
        id: profile.id,
        name: profile.name,
        databasePath: profile.databasePath,
        db,
        repository: new RehearsalRepository(db),
      });
    }
  }

  static async create(options: ProfileManagerOptions) {
    const profilesDir = path.join(options.dataDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(profilesDir, 0o700);
    const registryPath = path.join(profilesDir, registryName);
    if (!fs.existsSync(registryPath)) writePrivateJson(registryPath, createRegistry(profilesDir, options.pins));
    const registry = readRegistry(registryPath);
    await migrateLegacyDatabase(options, registry);
    return new ProfileManager(registry);
  }

  listProfiles() {
    return this.registry.profiles.map(({ id, name }) => ({ id, name }));
  }

  hasProfile(value: string): value is ProfileId {
    return profileIds.includes(value as ProfileId);
  }

  verifyPin(profileId: ProfileId, pin: string) {
    if (!pinPattern.test(pin)) return false;
    const profile = this.registry.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return false;
    const actual = scryptSync(pin, Buffer.from(profile.pinSalt, "base64"), 64);
    const expected = Buffer.from(profile.pinHash, "base64");
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  }

  get(profileId: ProfileId) {
    const context = this.contexts.get(profileId);
    if (!context) throw new Error(`Profile is unavailable: ${profileId}`);
    return context;
  }

  health() {
    return profileIds.map((id) => ({ id, ok: this.get(id).repository.system.quickCheck() }));
  }

  close() {
    for (const context of this.contexts.values()) context.db.close();
    this.contexts.clear();
  }
}
