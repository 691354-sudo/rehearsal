import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  languageCodes,
  type InvitationPurpose,
  type LanguageCode,
} from "../../contracts/api.js";
import { openDatabase } from "../db/database.js";
import { seedPilotOnboarding } from "../onboarding/pilot.js";

export type InvitedProfileRecord<ProfileRecord> = {
  state: "initializing" | "ready";
  language: LanguageCode;
  invitationHash: string;
  purpose?: InvitationPurpose;
  profile: ProfileRecord;
};

export type InvitedProfileRegistry<ProfileRecord> = {
  version: 1;
  profiles: Array<InvitedProfileRecord<ProfileRecord>>;
};

export type InvitationRecord = {
  hash: string;
  createdAt: string;
  createdByProfileId: string;
  purpose?: InvitationPurpose;
  revokedAt?: string | null;
  usedAt: string | null;
  usedByProfileId: string | null;
};

export type InvitationRegistry = {
  version: 1;
  invitations: InvitationRecord[];
};

export const invitedRegistryName = "invited-registry.json";
export const invitationRegistryName = "profile-invites.json";
const invitedProfileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const inviteAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const writePrivateJson = (destination: string, value: unknown) => {
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  fs.chmodSync(destination, 0o600);
};

export const saveInvitedProfiles = <ProfileRecord>(
  profilesDir: string,
  registry: InvitedProfileRegistry<ProfileRecord>,
) => writePrivateJson(path.join(profilesDir, invitedRegistryName), registry);

export const saveInvitations = (profilesDir: string, registry: InvitationRegistry) =>
  writePrivateJson(path.join(profilesDir, invitationRegistryName), registry);

export const readInvitedProfiles = <ProfileRecord extends { id: string; databasePath: string }>(
  profilesDir: string,
): InvitedProfileRegistry<ProfileRecord> => {
  const registryPath = path.join(profilesDir, invitedRegistryName);
  if (!fs.existsSync(registryPath)) return { version: 1, profiles: [] };
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as InvitedProfileRegistry<ProfileRecord>;
  if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) throw new Error("Invalid invited profile registry");
  const ids = new Set<string>();
  for (const entry of parsed.profiles) {
    const profile = entry.profile;
    if (!profile || !invitedProfileIdPattern.test(profile.id) || ids.has(profile.id)
      || path.basename(profile.databasePath) !== `${profile.id}.sqlite`
      || !["initializing", "ready"].includes(entry.state)
      || (entry.purpose !== undefined && !["standard", "onboarding_v1_pilot"].includes(entry.purpose))
      || !languageCodes.includes(entry.language)) {
      throw new Error("Invalid invited profile registry entry");
    }
    ids.add(profile.id);
  }
  return parsed;
};

export const readInvitations = (profilesDir: string): InvitationRegistry => {
  const registryPath = path.join(profilesDir, invitationRegistryName);
  if (!fs.existsSync(registryPath)) return { version: 1, invitations: [] };
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as InvitationRegistry;
  if (parsed.version !== 1 || !Array.isArray(parsed.invitations)) throw new Error("Invalid profile invitation registry");
  return parsed;
};

const normalizedInvite = (token: string) => token.replaceAll("-", "").trim().toUpperCase();
export const hashInvite = (token: string) =>
  createHash("sha256").update(normalizedInvite(token)).digest("base64url");

export const createInviteToken = (invitations: InvitationRegistry) => {
  let token = "";
  do {
    const bytes = randomBytes(5);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    let encoded = "";
    for (let index = 0; index < 8; index += 1) {
      encoded = inviteAlphabet[Number(value & 31n)] + encoded;
      value >>= 5n;
    }
    token = `${encoded.slice(0, 4)}-${encoded.slice(4)}`;
  } while (invitations.invitations.some((invite) => invite.hash === hashInvite(token)));
  return token;
};

export const createProfileInvitation = <ProfileRecord>(input: {
  invitations: InvitationRegistry;
  invitedProfiles: InvitedProfileRegistry<ProfileRecord>;
  createdByProfileId: string;
  purpose: InvitationPurpose;
}) => {
  if (input.purpose === "onboarding_v1_pilot") {
    if (input.createdByProfileId !== "roman") throw new Error("PILOT_INVITE_FORBIDDEN");
    if (input.invitedProfiles.profiles.some((entry) => entry.purpose === "onboarding_v1_pilot")) {
      throw new Error("PILOT_PROFILE_EXISTS");
    }
    const revokedAt = new Date().toISOString();
    input.invitations.invitations.forEach((invitation) => {
      if (invitation.purpose === "onboarding_v1_pilot" && !invitation.usedAt && !invitation.revokedAt) {
        invitation.revokedAt = revokedAt;
      }
    });
  }
  const token = createInviteToken(input.invitations);
  input.invitations.invitations.push({
    hash: hashInvite(token),
    createdAt: new Date().toISOString(),
    createdByProfileId: input.createdByProfileId,
    purpose: input.purpose,
    revokedAt: null,
    usedAt: null,
    usedByProfileId: null,
  });
  return token;
};

export const inviteAvailable = (invitations: InvitationRegistry, token: string) => {
  const invitation = invitationRecordForToken(invitations, token);
  return Boolean(invitation && !invitation.usedAt && !invitation.revokedAt);
};

export const invitationRecordForToken = (invitations: InvitationRegistry, token: string) => {
  const normalized = normalizedInvite(token);
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(normalized)) return null;
  const hash = hashInvite(normalized);
  return invitations.invitations.find((invite) => invite.hash === hash) || null;
};

export const invitationForToken = (invitations: InvitationRegistry, token: string) => {
  const invitation = invitationRecordForToken(invitations, token);
  return invitation && !invitation.usedAt && !invitation.revokedAt ? invitation : null;
};

export const initializeInvitedDatabase = <ProfileRecord extends { id: string; databasePath: string }>(
  entry: InvitedProfileRecord<ProfileRecord>,
) => {
  const db = openDatabase(entry.profile.databasePath);
  try {
    if (!db.prepare("SELECT 1 FROM languages WHERE code = ?").get(entry.language)) {
      throw new Error(`Unknown language for invited profile: ${entry.language}`);
    }
    db.prepare("UPDATE languages SET enabled = CASE WHEN code = ? THEN 1 ELSE 0 END").run(entry.language);
    if (entry.purpose === "onboarding_v1_pilot") {
      seedPilotOnboarding(db, entry.language);
    } else {
      const items = db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number };
      if (items.count !== 0) throw new Error(`Invited profile database is not empty: ${entry.profile.id}`);
    }
    if ((db.pragma("quick_check", { simple: true }) as string) !== "ok") {
      throw new Error(`SQLite quick_check failed for invited profile: ${entry.profile.id}`);
    }
  } finally {
    db.close();
  }
};

export const finishPendingInvitedProfiles = <ProfileRecord extends { id: string; databasePath: string }>(
  profilesDir: string,
  registry: InvitedProfileRegistry<ProfileRecord>,
) => {
  let changed = false;
  for (const entry of registry.profiles) {
    if (entry.state === "ready") {
      if (!fs.existsSync(entry.profile.databasePath)) {
        throw new Error(
          `Profile database missing after initialization: ${entry.profile.id}. Stop the API and restore the named profile from a verified backup.`,
        );
      }
      continue;
    }
    initializeInvitedDatabase(entry);
    entry.state = "ready";
    changed = true;
  }
  if (changed) saveInvitedProfiles(profilesDir, registry);
};
