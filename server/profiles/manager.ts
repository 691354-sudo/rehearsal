import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import {
  languageCodes,
  type InvitationPurpose,
  type LanguageCode,
  type OnboardingState,
} from "../../contracts/api.js";
import { openDatabase, type RehearsalDatabase } from "../db/database.js";
import { RehearsalRepository } from "../db/repository.js";
import {
  createProfileInvitation,
  finishPendingInvitedProfiles,
  hashInvite,
  initializeInvitedDatabase,
  inviteAvailable,
  invitationForToken,
  invitationRecordForToken,
  readInvitations,
  readInvitedProfiles,
  saveInvitations,
  saveInvitedProfiles,
  type InvitationRegistry,
  type InvitedProfileRecord,
  type InvitedProfileRegistry,
} from "./invited-profiles.js";
import {
  completePilotOnboarding,
  getPilotOnboardingState,
  unavailableOnboardingState,
} from "../onboarding/pilot.js";

const baseProfileIds = ["roman", "oliver"] as const;
export const profileIds = [...baseProfileIds, "zanna"] as const;
export type StaticProfileId = typeof profileIds[number];
export type ProfileId = string;

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

type AdditionalProfileRegistry = {
  version: 1;
  state: "initializing" | "ready";
  profile: ProfileRecord;
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
  pins: Record<StaticProfileId, string>;
};

const pinPattern = /^\d{4,12}$/;
const newPinPattern = /^\d{4,10}$/;
const registryName = "registry.json";
const additionalRegistryName = "additional-registry.json";
const migrationReportName = "migration.json";
const profileNames: Record<StaticProfileId, string> = { roman: "Roman", oliver: "Oliver", zanna: "Zanna" };

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

const createProfileRecord = (profilesDir: string, id: ProfileId, name: string, pin: string): ProfileRecord => {
  if (!pinPattern.test(pin)) throw new Error(`${id.toUpperCase()}_PROFILE_PIN must contain 4-12 digits`);
  const salt = randomBytes(16);
  return {
    id,
    name,
    databasePath: path.join(profilesDir, `${id}.sqlite`),
    pinSalt: salt.toString("base64"),
    pinHash: scryptSync(pin, salt, 64).toString("base64"),
  };
};

const createRegistry = (profilesDir: string, pins: Record<StaticProfileId, string>): ProfileRegistry => ({
  version: 1,
  profiles: baseProfileIds.map((id) => createProfileRecord(profilesDir, id, profileNames[id], pins[id])),
});

const readRegistry = (registryPath: string): ProfileRegistry => {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as ProfileRegistry;
  if (parsed.version !== 1 || parsed.profiles.length !== baseProfileIds.length) {
    throw new Error("Unsupported or incomplete profile registry");
  }
  for (const id of baseProfileIds) {
    const profile = parsed.profiles.find((candidate) => candidate.id === id);
    if (!profile || path.basename(profile.databasePath) !== `${id}.sqlite`) {
      throw new Error(`Invalid ${id} profile registry entry`);
    }
  }
  return parsed;
};

const ensureAdditionalProfile = (profilesDir: string, pins: Record<StaticProfileId, string>) => {
  const registryPath = path.join(profilesDir, additionalRegistryName);
  const databasePath = path.join(profilesDir, "zanna.sqlite");
  if (!fs.existsSync(registryPath)) {
    if (fs.existsSync(databasePath)) {
      throw new Error("Zanna database exists without its profile registry; restore or remove both together");
    }
    writePrivateJson(registryPath, {
      version: 1,
      state: "initializing",
      profile: createProfileRecord(profilesDir, "zanna", profileNames.zanna, pins.zanna),
    } satisfies AdditionalProfileRegistry);
  }

  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as AdditionalProfileRegistry;
  if (parsed.version !== 1 || parsed.profile?.id !== "zanna"
    || path.basename(parsed.profile.databasePath) !== "zanna.sqlite"
    || !["initializing", "ready"].includes(parsed.state)) {
    throw new Error("Invalid additional profile registry");
  }
  if (parsed.state === "ready" && !fs.existsSync(parsed.profile.databasePath)) {
    throw new Error(
      "Profile database missing after initialization: zanna. Stop the API and restore the named profile from a verified backup.",
    );
  }
  if (parsed.state === "initializing") {
    const db = openDatabase(parsed.profile.databasePath);
    db.close();
    parsed.state = "ready";
    writePrivateJson(registryPath, parsed);
  }
  return parsed.profile;
};

const normalizeProfileName = (value: string) => value.trim().replace(/\s+/g, " ");

export const registeredProfilesFromDisk = (dataDir: string) => {
  const profilesDir = path.join(dataDir, "profiles");
  const records: ProfileRecord[] = [];
  const basePath = path.join(profilesDir, registryName);
  if (fs.existsSync(basePath)) records.push(...readRegistry(basePath).profiles);
  const additionalPath = path.join(profilesDir, additionalRegistryName);
  if (fs.existsSync(additionalPath)) {
    const additional = JSON.parse(fs.readFileSync(additionalPath, "utf8")) as AdditionalProfileRegistry;
    if (additional.state === "ready" || fs.existsSync(additional.profile.databasePath)) records.push(additional.profile);
  }
  records.push(...readInvitedProfiles<ProfileRecord>(profilesDir).profiles
    .filter((entry) => entry.state === "ready" || fs.existsSync(entry.profile.databasePath))
    .map((entry) => entry.profile));
  return records;
};

const initializeProfileDatabases = async (
  options: ProfileManagerOptions,
  registry: ProfileRegistry,
  registryCreated: boolean,
) => {
  const missing = registry.profiles.filter((profile) => !fs.existsSync(profile.databasePath));
  if (!missing.length) return;

  if (!registryCreated) {
    const profileList = missing.map((profile) => profile.id).join(", ");
    throw new Error(
      `Profile database missing after initialization: ${profileList}. Stop the API and restore the named profile from a verified backup.`,
    );
  }

  if (missing.length !== registry.profiles.length) {
    throw new Error("Incomplete profile database set found during initialization; restore the registry and profile backups");
  }

  if (!fs.existsSync(options.legacyDatabasePath)) {
    let counts: Record<string, number> | null = null;
    for (const profile of missing) {
      const temporaryPath = `${profile.databasePath}.${process.pid}.tmp`;
      const db = openDatabase(temporaryPath);
      try {
        counts ??= tableCounts(db);
      } finally {
        db.close();
      }
      fs.renameSync(temporaryPath, profile.databasePath);
    }
    writePrivateJson(path.join(path.dirname(registry.profiles[0].databasePath), migrationReportName), {
      migratedAt: new Date().toISOString(),
      mode: "fresh",
      source: null,
      archive: null,
      profiles: missing.map((profile) => profile.id),
      counts,
    });
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
      const temporaryPath = `${profile.databasePath}.${process.pid}.tmp`;
      await source.backup(temporaryPath);
      assertHealthyCopy(temporaryPath, expected);
      fs.renameSync(temporaryPath, profile.databasePath);
    }

    writePrivateJson(path.join(path.dirname(registry.profiles[0].databasePath), migrationReportName), {
      migratedAt: new Date().toISOString(),
      mode: "legacy",
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
  private readonly records = new Map<ProfileId, ProfileRecord>();

  private constructor(
    profiles: ProfileRecord[],
    private readonly profilesDir: string,
    private readonly invitedRegistry: InvitedProfileRegistry<ProfileRecord>,
    private readonly invitations: InvitationRegistry,
  ) {
    for (const profile of profiles) {
      const db = openDatabase(profile.databasePath);
      this.records.set(profile.id, profile);
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
    const registryCreated = !fs.existsSync(registryPath);
    let registry: ProfileRegistry;
    if (registryCreated) {
      const existingProfileFiles = fs.readdirSync(profilesDir).filter((name) => name.endsWith(".sqlite"));
      if (existingProfileFiles.length) {
        throw new Error("Profile registry is missing while profile databases exist; restore registry.json before starting");
      }
      registry = createRegistry(profilesDir, options.pins);
      try {
        await initializeProfileDatabases(options, registry, true);
        writePrivateJson(registryPath, registry);
      } catch (error) {
        for (const profile of registry.profiles) fs.rmSync(profile.databasePath, { force: true });
        fs.rmSync(path.join(profilesDir, migrationReportName), { force: true });
        throw error;
      }
    } else {
      registry = readRegistry(registryPath);
      await initializeProfileDatabases(options, registry, false);
    }
    const additionalProfile = ensureAdditionalProfile(profilesDir, options.pins);
    const invitedRegistry = readInvitedProfiles<ProfileRecord>(profilesDir);
    finishPendingInvitedProfiles(profilesDir, invitedRegistry);
    const invitations = readInvitations(profilesDir);
    let invitationsChanged = false;
    for (const entry of invitedRegistry.profiles.filter((candidate) => candidate.state === "ready")) {
      const invitation = invitations.invitations.find((candidate) => candidate.hash === entry.invitationHash);
      if (invitation && !invitation.usedAt) {
        invitation.usedAt = new Date().toISOString();
        invitation.usedByProfileId = entry.profile.id;
        invitationsChanged = true;
      }
    }
    if (invitationsChanged) saveInvitations(profilesDir, invitations);
    return new ProfileManager(
      [...registry.profiles, additionalProfile, ...invitedRegistry.profiles.map((entry) => entry.profile)],
      profilesDir,
      invitedRegistry,
      invitations,
    );
  }

  listProfiles() {
    return [...this.records.values()].map(({ id, name }) => ({ id, name }));
  }

  hasProfile(value: string): value is ProfileId {
    return this.records.has(value);
  }

  verifyPin(profileId: ProfileId, pin: string) {
    if (!pinPattern.test(pin)) return false;
    const profile = this.records.get(profileId);
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

  createInvite(createdByProfileId: ProfileId, purpose: InvitationPurpose = "standard") {
    if (!this.hasProfile(createdByProfileId)) throw new Error("Profile is unavailable");
    const token = createProfileInvitation({
      invitations: this.invitations, invitedProfiles: this.invitedRegistry, createdByProfileId, purpose,
    });
    saveInvitations(this.profilesDir, this.invitations);
    return token;
  }

  inviteAvailable(token: string) {
    return inviteAvailable(this.invitations, token);
  }

  inviteExperience(token: string) {
    const invitation = invitationRecordForToken(this.invitations, token);
    const replayProfileId = invitation?.purpose === "onboarding_v1_pilot" && invitation.usedAt
      && invitation.usedByProfileId && !invitation.revokedAt ? invitation.usedByProfileId : null;
    return [invitation ? invitation.purpose || "standard" : null, Boolean(replayProfileId), replayProfileId] as const;
  }

  onboardingState(profileId: ProfileId): OnboardingState {
    const pilot = this.invitedRegistry.profiles.some((entry) =>
      entry.profile.id === profileId && entry.purpose === "onboarding_v1_pilot");
    return pilot ? getPilotOnboardingState(this.get(profileId).db) : unavailableOnboardingState();
  }

  completeOnboarding(profileId: ProfileId): OnboardingState {
    const state = this.onboardingState(profileId);
    if (state.eligibility !== "pilot") throw new Error("ONBOARDING_NOT_AVAILABLE");
    return completePilotOnboarding(this.get(profileId).db);
  }

  createInvitedProfile(input: { token: string; name: string; pin: string; language: LanguageCode }) {
    const invitation = invitationForToken(this.invitations, input.token);
    if (!invitation) throw new Error("INVITATION_UNAVAILABLE");
    const purpose = invitation.purpose || "standard";
    if (purpose === "onboarding_v1_pilot"
      && this.invitedRegistry.profiles.some((entry) => entry.purpose === "onboarding_v1_pilot")) {
      throw new Error("PILOT_PROFILE_EXISTS");
    }
    const name = normalizeProfileName(input.name);
    if (name.length < 1 || name.length > 40) throw new Error("INVALID_PROFILE_NAME");
    if ([...this.records.values()].some((profile) => profile.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) {
      throw new Error("PROFILE_NAME_TAKEN");
    }
    if (!newPinPattern.test(input.pin)) throw new Error("INVALID_NEW_PROFILE_PIN");
    if (!languageCodes.includes(input.language)) throw new Error("INVALID_PROFILE_LANGUAGE");

    const id = randomUUID();
    const hash = hashInvite(input.token);
    const profile = createProfileRecord(this.profilesDir, id, name, input.pin);
    const entry: InvitedProfileRecord<ProfileRecord> = {
      state: "initializing",
      language: input.language,
      invitationHash: hash,
      purpose,
      profile,
    };
    this.invitedRegistry.profiles.push(entry);
    saveInvitedProfiles(this.profilesDir, this.invitedRegistry);
    initializeInvitedDatabase(entry);
    entry.state = "ready";
    saveInvitedProfiles(this.profilesDir, this.invitedRegistry);

    invitation.usedAt = new Date().toISOString();
    invitation.usedByProfileId = id;
    saveInvitations(this.profilesDir, this.invitations);

    const db = openDatabase(profile.databasePath);
    this.records.set(id, profile);
    this.contexts.set(id, {
      id,
      name,
      databasePath: profile.databasePath,
      db,
      repository: new RehearsalRepository(db),
    });
    return { id, name };
  }

  health() {
    return [...this.contexts].map(([id, context]) => ({ id, ok: context.repository.system.quickCheck() }));
  }

  close() {
    for (const context of this.contexts.values()) context.db.close();
    this.contexts.clear();
  }
}
