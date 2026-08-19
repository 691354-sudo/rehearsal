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

nginx terminates HTTPS and removes the `/rehearsal/` prefix before proxying to the loopback API binding. Card Drill streams the existing per-card speech responses, so the production image has no FFmpeg dependency.

The application root is not a Git checkout. GitHub Actions uploads the exact CI-checked commit to `/opt/apps/rehearsal/releases/<sha>` and points `/opt/apps/rehearsal/current` at the last healthy release. It never replaces or uploads the server's `data`, `backups`, `.env`, or `.env.elevenlabs` paths.

Deployment runs only after the `CI` workflow succeeds for a push to `main`. An automatic run skips Markdown-only commits because they do not change the application; a manual run always deploys the exact current `main`. Deployments are serialized and the server retains the five most recent releases.

Required repository secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`
- `PRODUCTION_URL` (the application base URL, currently `https://7662n.cc/rehearsal/`)
- `ROMAN_PROFILE_PIN` and `OLIVER_PROFILE_PIN` (4–12 digits);
- `SESSION_SECRET` (a random value of at least 32 bytes).

`deploy/rehearsal-backup.cron` creates a consistent SQLite backup nightly and removes backups older than 30 days. `deploy/rehearsal-model-check.cron` runs daily, while the model checker's timestamp guard permits a live provider check only once every 14 days.

The workflow installs the three profile/session values as mode-`0600` files under `/opt/apps/rehearsal/secrets`; Compose mounts that directory read-only. Provider credentials remain in `/opt/apps/rehearsal/.env` and `.env.elevenlabs`.

Do not rotate profile PINs by changing the GitHub secret after the registry exists: the registry holds the salted scrypt hashes and remains authoritative. A deliberate PIN-rotation tool is not part of this release. Changing `SESSION_SECRET` invalidates every active browser session at the next deployment.

## Profile data and first rollout

Profile state lives only under the persistent data volume:

- `/opt/apps/rehearsal/data/profiles/roman.sqlite`;
- `/opt/apps/rehearsal/data/profiles/oliver.sqlite`;
- `/opt/apps/rehearsal/data/profiles/registry.json` (names, database paths, PIN salts and hashes);
- `/opt/apps/rehearsal/data/profiles/migration.json` (private migration evidence).

On the first profile-aware start, the application archives the existing `rehearsal.sqlite`, copies its complete contents into each missing profile database, runs `quick_check`, and compares counters for all user-data tables. Existing profile databases are never overwritten on a repeated start. Keep the legacy database and `legacy-before-profiles-*.sqlite` archive until both users complete acceptance checks.

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
```

Stop the API before restore. Restore validates the candidate with SQLite `quick_check` and creates a safety copy of only the selected profile database before replacement. Never restore one profile's file into the other profile without an explicit data-recovery decision.

## Production verification

Every release builds the new image, creates a database backup with that image, replaces the container, and then verifies:

```bash
curl -fsS http://127.0.0.1:8788/health
curl -fsS https://7662n.cc/rehearsal/health
```

`/health` runs `quick_check` for both profile databases and returns only their availability, never counts or user content. During the first rollout, also inspect the private migration report and confirm that both copies have the source counters recorded immediately before migration.

## Secrets

`.env` and `.env.elevenlabs` contain live credentials. Do not print, commit, copy into a release, or include them in logs. GitHub deployment credentials belong in encrypted repository secrets. Runtime databases, backups, profile registries, PIN values and hashes, session secrets, and generated audio are never Git artifacts.

## Recovery

If either health check fails, the deployment script starts the previous release again without replacing persistent data. Restore a database only when application rollback is insufficient, and always preserve a pre-restore safety copy.

The first release treats the existing `/opt/apps/rehearsal` directory as the rollback target. After the first successful deployment, `current` is the canonical compose path for cron and operator commands.
