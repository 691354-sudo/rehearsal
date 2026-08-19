# Rehearsal handoff

This file is the starting point for another LLM or developer continuing the project.

## Locations

- Local project: `/Users/working/Documents/ChatGPT/English site`
- Production: `https://7662n.cc/rehearsal/`
- Server: `root@propbot`
- Server project: `/opt/apps/rehearsal`
- Production compose file: `/opt/apps/rehearsal/compose.production.yml`
- Production database: `/opt/apps/rehearsal/data/rehearsal.sqlite`
- Production backups: `/opt/apps/rehearsal/backups`

Do not print, commit, or copy the contents of `.env` or `.env.elevenlabs`. They contain the live API credentials.

## First reading

Read these files before changing product behavior:

1. `docs/METHOD.md` — learning method and product rules.
2. `docs/ARCHITECTURE.md` — data, LLM, search, audio, and safety boundaries.
3. `docs/MOBILE_APP_DIRECTION.md` — installable iPhone target and mobile constraints.
4. `.interface-design/system.md` — approved UI direction and tokens.
5. `README.md` — local setup and production operations.
6. This file — current handoff and verification checklist.

## Product invariants

- UI chrome is English; Russian is the recall cue, not interface copy.
- Recall is keyboard-first on desktop: first Enter checks locally; Good is selected; arrow keys choose Again, Hard, Good, or Easy; the next Enter commits and focuses the next card.
- Every core action also has a visible touch path. Phone use must never depend on Enter, arrow keys, hover, or a hardware keyboard.
- Recall comparison must never wait for an LLM request.
- Shadowing has no memory grades. Repetition, voice, speed, and pause are playback settings.
- Thumbs up/down tune priority. Neither selected means Neutral.
- Tutor behaves like a normal chat and reviews the whole current session only after `Finish & review`.
- Tutor suggestions, imported vocabulary contexts, corrections, and pattern drills stay in a draft batch. Nothing enters Library without explicit user selection.
- English and Latvian content, due queues, progress, and Tutor histories remain separate.
- Content should be current, natural, adult casual language—not dated phrases or forced youth slang.
- The intended phone target is an installable Home Screen PWA in standalone mode, not an App Store release. Preserve future Capacitor compatibility without speculative native work.

## Main code map

- `src/components/DesignLab.tsx` — current Practice, Tutor, Library, Settings, keyboard flow, and card editor.
- `src/components/design-lab.css` — current responsive design system and component states.
- `src/lib/compare.ts` — instant deterministic recall comparison.
- `src/lib/sessionQueue.ts` — keyboard grade ordering and shadow queue behavior.
- `server/app.ts` — HTTP API and validation.
- `server/db/repository.ts` — SQLite persistence, FTS search, changes, due queue, and review batches.
- `server/services/scheduler.ts` — FSRS-6 integration and project-specific limits.
- `server/services/tutor.ts` — Tutor prompt and read-only tool loop.
- `server/model-routing.ts` — Sol/Terra/Luna workload routing.
- `server/data/seed-content.ts` — curated English and Latvian test material.

Several older UI components remain in `src/components/`, but the active product is `DesignLab.tsx`. Do not refactor or delete the older prototype unless the user explicitly asks.

## Local run and verification

```bash
cd "/Users/working/Documents/ChatGPT/English site"
npm install
npm run dev
```

- Web: `http://127.0.0.1:4173/`
- API: `http://127.0.0.1:8787/health`

Run the deterministic suite without contacting paid services:

```bash
OPENAI_API_KEY=' ' ELEVENLABS_API_KEY=' ' npm test
npm run build
```

The API tests cover edit, preference, deletion, and SQLite restart persistence. Before a release, also verify the actual browser flow on desktop and mobile widths. Once the installable PWA milestone starts, additionally verify a real iPhone in Safari and Home Screen standalone mode using the gate in `docs/MOBILE_APP_DIRECTION.md`.

## Database and recovery

Local SQLite data lives at `.data/rehearsal.sqlite`. It uses WAL, foreign keys, FTS5, an append-only change log, and online backups.

```bash
npm run db:backup
CONFIRM_RESTORE=1 npm run db:restore -- /absolute/path/to/backup.sqlite
```

Stop the API before restore. The restore command runs `quick_check` and creates a safety copy of the current database first.

Production creates a consistent backup every night at 03:15 and removes backups older than 30 days. To create one immediately:

```bash
ssh root@propbot 'cd /opt/apps/rehearsal && docker compose -f compose.production.yml exec -T app npm run db:backup'
```

## Production release check

Never replace the production `data/`, `backups/`, `.env`, or `.env.elevenlabs` directories with local copies.

After syncing application files to `/opt/apps/rehearsal`:

```bash
ssh root@propbot 'cd /opt/apps/rehearsal && docker compose -f compose.production.yml up -d --build'
ssh root@propbot 'cd /opt/apps/rehearsal && docker compose -f compose.production.yml ps'
ssh root@propbot 'curl -fsS http://127.0.0.1:8788/health'
curl -fsS https://7662n.cc/rehearsal/health
```

Verify after the container restart that item/source/attempt counts are unchanged and SQLite returns `quick_check = ok` and no foreign-key violations.

## Current feature baseline

- Practice feed with RU → target recall and target → RU shadowing.
- Instant local answer diff with a keyboard-efficient desktop and touch-complete phone FSRS rating loop.
- Editable/deletable practice cards and persistent Like/Dislike priority.
- Configurable OpenAI and ElevenLabs speech, including live voice verification, provider-safe speed ranges, repetitions, pauses, persistent MP3 caching, and concurrent-request deduplication.
- Tutor sessions with history, language separation, uploads, vocabulary context generation, and `Finish & review`.
- Library search, import, review-before-commit, editing, deletion, category/frequency metadata.
- FSRS-6 scheduling, daily progress, backups, restore validation, and periodic model routing checks.
