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

nginx terminates HTTPS and removes the `/rehearsal/` prefix before proxying to the loopback API binding. The production image includes FFmpeg for Saturation assembly.

The application root is not a Git checkout. Until the release workflow is enabled, production updates remain a controlled manual operation after a reviewed merge. The target workflow uploads reviewed commits as release artifacts; it must never replace or upload the server's `data`, `backups`, `.env`, or `.env.elevenlabs` paths.

`deploy/rehearsal-backup.cron` creates a consistent SQLite backup nightly and removes backups older than 30 days. `deploy/rehearsal-model-check.cron` runs daily, while the model checker's timestamp guard permits a live provider check only once every 14 days.

## Local data

The current single-profile database is `.data/rehearsal.sqlite`. It uses WAL, foreign keys, FTS5, and an append-only change log.

```bash
npm run db:seed
npm run db:backup
CONFIRM_RESTORE=1 npm run db:restore -- /absolute/path/to/backup.sqlite
```

Stop the API before restore. Restore validates the candidate with SQLite `quick_check` and creates a safety copy of the current database before replacement.

## Production verification

Every manual or automated release must create a database backup before replacing the running container, then verify:

```bash
curl -fsS http://127.0.0.1:8788/health
curl -fsS https://7662n.cc/rehearsal/health
```

Also confirm that SQLite `quick_check` succeeds, foreign-key checks are empty, and user-data counts have not unexpectedly changed.

## Secrets

`.env` and `.env.elevenlabs` contain live credentials. Do not print, commit, copy into a release, or include them in logs. GitHub deployment credentials belong in encrypted repository secrets. Runtime databases, backups, profile registries, PIN hashes, and generated audio are never Git artifacts.

## Recovery

If a release fails its health checks, restore the previous application release without replacing persistent data. Restore a database only when application rollback is insufficient, and always preserve a pre-restore safety copy.
