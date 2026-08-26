import { config } from "../server/config.js";
import { ProfileManager, type StaticProfileId } from "../server/profiles/manager.js";

const args = process.argv.slice(2);
const valueAfter = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() || "" : "";
};

const profileId = valueAfter("--profile");
const unbindUserId = valueAfter("--unbind");
if ((args.includes("--profile") && !profileId) || (args.includes("--unbind") && !unbindUserId)) {
  throw new Error("Usage: npm run db:telegram-bindings -- [--profile <profile>] [--unbind <telegram-user-id>]");
}

const manager = await ProfileManager.create({
  dataDir: config.dataDir,
  backupDir: config.backupDir,
  legacyDatabasePath: config.databasePath,
  pins: {
    roman: config.romanProfilePin,
    oliver: config.oliverProfilePin,
    zanna: config.zannaProfilePin,
  } satisfies Record<StaticProfileId, string>,
});

try {
  const profiles = profileId
    ? manager.listProfiles().filter((profile) => profile.id === profileId)
    : manager.listProfiles();
  if (!profiles.length) throw new Error(`Profile is unavailable: ${profileId}`);

  for (const profile of profiles) {
    const bindings = manager.telegram.list(profile.id);
    console.log(JSON.stringify({
      profile: profile.id,
      name: profile.name,
      bindings,
    }, null, 2));
  }

  if (unbindUserId) {
    if (!profileId) throw new Error("--profile is required with --unbind");
    const confirmation = `${profileId}:${unbindUserId}`;
    if (process.env.CONFIRM_TELEGRAM_UNBIND !== confirmation) {
      console.log(`Dry run only. Set CONFIRM_TELEGRAM_UNBIND=${confirmation} to remove this exact binding.`);
    } else if (manager.telegram.unbind(profileId, unbindUserId)) {
      console.log(`Removed Telegram binding ${unbindUserId} from ${profileId}.`);
    } else {
      throw new Error("Telegram binding was not found");
    }
  }
} finally {
  manager.close();
}
