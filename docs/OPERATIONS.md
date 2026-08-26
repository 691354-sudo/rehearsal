# Rehearsal operations

This document is the canonical source for production deployment, data paths, backups, restore, and recovery.

## Production

- Public URL: `https://7662n.cc/rehearsal/`
- Server: `root@propbot`
- Application root: `/opt/apps/rehearsal`
- Compose file: `/opt/apps/rehearsal/compose.production.yml`
- API binding: `127.0.0.1:8788`
- Persistent data: `/opt/apps/rehearsal/data`
- Backups: `/opt/apps/rehearsal/backups`

nginx terminates HTTPS and removes the `/rehearsal/` prefix before proxying to the loopback API binding. Listen & Repeat streams the existing per-card speech responses, so the production image has no FFmpeg dependency. nginx allows multipart overhead above the API's 25 MiB recording limit.

The application root is not a Git checkout. GitHub Actions uploads the exact CI-checked commit to `/opt/apps/rehearsal/releases/<sha>` and points `/opt/apps/rehearsal/current` at the last healthy release. It never replaces or uploads the server's `data`, `backups`, `.env`, or `.env.elevenlabs` paths.

Deployment runs only after the `CI` workflow succeeds for a push to `main`. For a Markdown-only commit, the automatic workflow completes successfully after recording `Skip Markdown-only release`; its upload and deployment steps are skipped because the application did not change. A manual run always deploys the exact current `main`. Deployments are serialized and the server retains the five most recent releases.

## Production delivery gate

When Roman asks to ship, deploy, or put a change in production, the task is complete only after all applicable gates succeed:

1. the ready pull request is green and the exact checked head is squash merged into `main` according to [CONTRIBUTING.md](CONTRIBUTING.md);
2. the post-merge `CI` run for that `main` commit succeeds;
3. the matching `Deploy production` workflow finishes successfully;
4. `https://7662n.cc/rehearsal/health` succeeds from outside the server;
5. the delivery report identifies the merged commit and the CI, deployment, and health-check results.

Do not report a production request as complete after only pushing a branch, opening a pull request, passing branch CI, or merging. Follow the post-merge runs to their terminal state. If CI or deployment fails, inspect the workflow logs and fix the failure through a new pull request; do not bypass GitHub by editing or copying application files on the server. The deployment workflow's built-in rollback remains the first recovery path.

For a Markdown-only commit, confirm that the commit is present on `origin/main`, post-merge CI succeeds, and the `Deploy production` workflow succeeds with `Skip Markdown-only release` while its actual deployment steps remain skipped. Report that the existing runtime release remains active. Do not force a runtime deployment solely to publish documentation.

Required repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `PRODUCTION_URL` (the application base URL, currently `https://7662n.cc/rehearsal/`)
- `ROMAN_PROFILE_PIN`, `OLIVER_PROFILE_PIN`, and `ZANNA_PROFILE_PIN` (4–12 digits);
- `SESSION_SECRET` (a random value of at least 32 bytes).

`deploy/rehearsal-backup.cron` creates a consistent SQLite backup nightly and removes backups older than 30 days. Model availability is checked only by an operator running `npm run models:check` before a deliberate model configuration change. The deployment script removes the retired `/etc/cron.d/rehearsal-model-check` job after a healthy rollout.

## AI usage diagnosis

Run the read-only private report from the current release to find expensive or repeated AI work by profile, workload, language, provider, and model:

```bash
npm run ai-usage:report
npm run ai-usage:report -- --days 7 --profile roman
npm run ai-usage:report -- --days 30 --json
```

The report shows logical operations versus actual provider requests, failures, input/cached/cache-write/output/reasoning tokens, local speech-cache hits, input characters, audio bytes, and average latency. Its signals flag low Tutor prompt-cache reuse, high reasoning share, multi-round or chunk amplification, failed calls, and low speech-cache reuse. It is intentionally read-only and never prints prompts, responses, audio, filenames, PIN material, or provider error details. Do not hard-code provider prices into historical telemetry; reconcile these stable measured units with the current OpenAI and ElevenLabs billing exports when calculating USD.

The workflow installs the profile/session values as mode-`0600` files under `/opt/apps/rehearsal/secrets`; Compose mounts that directory read-only. Provider credentials remain in `/opt/apps/rehearsal/.env` and `.env.elevenlabs`.

Do not rotate profile PINs by changing the GitHub secret after the registry exists: the registry holds the salted scrypt hashes and remains authoritative. A deliberate PIN-rotation tool is not part of this release. Changing `SESSION_SECRET` invalidates every active browser session at the next deployment.

## Profile data and first rollout

Profile state lives only under the persistent data volume:

- `/opt/apps/rehearsal/data/profiles/roman.sqlite`;
- `/opt/apps/rehearsal/data/profiles/oliver.sqlite`;
- `/opt/apps/rehearsal/data/profiles/zanna.sqlite`;
- UUID-named SQLite files for invited profiles;
- `/opt/apps/rehearsal/data/profiles/registry.json`, `additional-registry.json`, and `invited-registry.json` (names, database paths, PIN salts and hashes);
- `/opt/apps/rehearsal/data/profiles/profile-invites.json` (hashed one-time invitation state);
- `/opt/apps/rehearsal/data/profiles/migration.json` (private migration evidence).

On the first profile-aware start, the application creates Roman and Oliver as one set. If a legacy `rehearsal.sqlite` exists, it is archived and copied completely to both databases, followed by `quick_check` and counter comparison. Without legacy data, both empty databases are created before the registry is published. Zanna is added separately with a new empty database. Invited profiles are additive UUID entries, so rolling back to a version that predates invitations leaves existing fixed profiles available while the older release ignores the new registry.

After a profile is marked ready in its registry, a missing database is a recovery incident: startup fails and names the profile that must be restored. The application never silently creates an empty replacement or copies legacy data into a missing initialized profile. A missing registry alongside existing profile databases also fails closed.

SQLite structure changes are ordered in `server/db/database.ts` and recorded once in `schema_migrations`. Each pending migration runs transactionally and checks foreign-key integrity before its marker is committed. A migration failure closes the database and fails startup; restore a verified backup or correct the migration rather than editing production tables manually.

For local development, set different non-production PINs and a random session secret in an untracked `.env`, then start normally:

```bash
npm run db:seed -- --profile roman
npm run dev
```

## Backup and selective restore

Backup creates one verified file per profile under `backups/profiles`:

```bash
npm run db:backup
CONFIRM_RESTORE=1 npm run db:restore -- --profile roman /absolute/path/to/roman-backup.sqlite
CONFIRM_RESTORE=1 npm run db:restore -- --profile oliver /absolute/path/to/oliver-backup.sqlite
CONFIRM_RESTORE=1 npm run db:restore -- --profile zanna /absolute/path/to/zanna-backup.sqlite
CONFIRM_RESTORE=1 npm run db:restore -- --profile <invited-profile-uuid> /absolute/path/to/profile-backup.sqlite
```

Stop the API before restore. Restore validates the candidate with SQLite `quick_check` and creates a safety copy of only the selected profile database before replacement. Never restore one profile's file into the other profile without an explicit data-recovery decision.

Cards without an owning Topic are invalid legacy data. Back up every profile, preview the exact cards, and use the count-bound confirmation before deleting them:

```bash
npm run db:backup
npm run db:delete-orphans -- --profile roman --dry-run
CONFIRM_DELETE_ORPHANS=roman:<preview-count> npm run db:delete-orphans -- --profile roman
```

The command deletes only cards with no `island_items` membership and finishes with SQLite foreign-key and quick checks.

## Curated Library replacement

A validated JSON import may replace one profile-and-language Library without touching the other language, Tutor chats, Capture notes, or the other profile. Always create and verify the profile backups first, preview the exact counts, and then use the matching confirmation value:

```bash
npm run db:backup
npm run db:replace-library -- --profile roman --input /absolute/path/roman-en.json --dry-run
CONFIRM_REPLACE_LIBRARY=roman:en npm run db:replace-library -- --profile roman --input /absolute/path/roman-en.json
```

The replacement validates duplicate targets and cues before opening the mutation transaction. Existing cards and Topics for only the selected language are deleted, then every new card and Topic is created in one SQLite transaction. The command finishes with `foreign_key_check` and `quick_check`; retain the pre-import backup until the learner has inspected the result in production.

## Profile language availability

Languages are enabled independently inside each profile database. Preview the exact change first; changing availability requires a profile-language-value confirmation and never deletes language data:

```bash
npm run db:set-language -- --profile oliver --language vi --enabled true --dry-run
CONFIRM_LANGUAGE_CHANGE=oliver:vi:true npm run db:set-language -- --profile oliver --language vi --enabled true
```

Before the first Vietnamese enablement, run `npm run db:backup` and retain both verified profile backups. Deploy the schema and application with Vietnamese disabled, configure `ELEVENLABS_VI_VOICE_ID` and `ELEVENLABS_VI_VOICE_NAME`, then run one separately authorized paid Flash v2.5 smoke test. Only after that acceptance may `vi` be enabled for Oliver. Rollback disables `vi` for Oliver and restores the prior application release; it does not remove Vietnamese cards, history, Topics, statistics, or cached audio.

Norwegian Bokmål is inserted as `no / nb-NO` for existing profiles by migration `006-norwegian-language`; invited profiles still start with only their selected language. Before production Norwegian playback, configure an approved native voice through `ELEVENLABS_NO_VOICE_ID` and `ELEVENLABS_NO_VOICE_NAME`, create and verify profile backups, and run one separately authorized paid Flash v2.5 smoke test. Without that voice, Norwegian remains available for written Recall but its audio controls report that no compatible voice is configured. Rollback restores the prior release without deleting Norwegian cards or schedules.

Indonesian is inserted as disabled `id / id-ID` for existing profiles by migration `009-indonesian-language`; invited profiles may still choose it as their one enabled language. Saved ElevenLabs voices with verified Indonesian metadata are discovered automatically, and the saved native Indonesian voice Zephlyn is the configured default through `ELEVENLABS_ID_VOICE_ID` and `ELEVENLABS_ID_VOICE_NAME`. Before the first production enablement, create and verify profile backups, confirm that `/api/config` lists Zephlyn under `voicesByLanguage.id`, and obtain separate approval for one paid Flash v2.5 smoke test. Then preview and explicitly enable only the intended profile with `npm run db:set-language -- --profile <profile> --language id --enabled true --dry-run` and `CONFIRM_LANGUAGE_CHANGE=<profile>:id:true npm run db:set-language -- --profile <profile> --language id --enabled true`. Rollback disables `id` for that profile and restores the prior application release without deleting Indonesian data.

## Closed onboarding pilot

Only Roman may use `Create onboarding test invitation` in Settings. Creating another unused pilot invitation revokes the previous unused pilot link; once its profile has been created, the server refuses every additional pilot invitation. This is a production gate, not a public launch: ordinary invitation links remain unchanged and empty.

After deployment, create the pilot link in Roman's Settings and join it once with the intended test name, language, and PIN. Verify the six starter cards, two Topics, Tutor example, processed Notebook history, both themes, completion, Settings replay, replay through the consumed pilot link, and a separate ordinary profile before treating the pilot as ready for user testing. The consumed link shows one explicit Echo test profile, accepts only its PIN, and resolves its UUID server-side; it never creates another profile, exposes the ordinary profile chooser, or bypasses authentication. Do not edit the private invitation or invited-profile registries manually. Public onboarding requires a later reviewed code change; there is no environment flag or data edit that broadens eligibility.

## Production verification

Every release builds the new image, creates separate backups for all currently registered profile databases, replaces the container, and then verifies:

```bash
curl -fsS http://127.0.0.1:8788/health
curl -fsS https://7662n.cc/rehearsal/health
```

`/health` runs `quick_check` for every profile database and returns only availability, never counts or user content. During the first rollout, also inspect the private migration report and confirm that both legacy copies have the source counters recorded immediately before migration.

## Secrets

`.env` and `.env.elevenlabs` contain live credentials. Do not print, commit, copy into a release, or include them in logs. GitHub deployment credentials belong in encrypted repository secrets. Runtime databases, backups, profile registries, PIN values and hashes, session secrets, and generated audio are never Git artifacts.

## Recovery

If either health check fails, the deployment script starts the previous release again without replacing persistent data. Restore a database only when application rollback is insufficient, and always preserve a pre-restore safety copy.

The first release treats the existing `/opt/apps/rehearsal` directory as the rollback target. After the first successful deployment, `current` is the canonical compose path for cron and operator commands.
