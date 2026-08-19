# Rehearsal current handoff

This file contains only current state and follow-up work. Every new session starts with [AGENTS.md](../AGENTS.md); do not copy canonical product, architecture, collaboration, mobile, or operations rules here.

## Current state

- The active UI is split into `src/app`, domain modules under `src/features`, shared contracts/config, and bounded style files. Practice, Tutor, Library, Settings, Capture Reality, Topics, and Card Drill are preserved; the legacy route and prototype source are removed.
- The API routes and SQLite repositories are split into domain modules; the runtime still opens one database at `.data/rehearsal.sqlite` locally and `/opt/apps/rehearsal/data/rehearsal.sqlite` in production.
- The GitHub deployment workflow uses immutable release directories. It is operational only after all deployment secrets are configured and the first manual run is verified.
- Deterministic tests and the production build pass without paid API calls.

## Main code map

- `src/app/RehearsalApp.tsx` — runtime shell, configuration, audio, and page composition.
- `src/features/` — Practice, Tutor, Library, Capture, Settings, and Review UI behavior, including Topics and Card Drill.
- `src/styles/` — approved tokens and feature-owned responsive styles.
- `src/lib/compare.ts` — instant deterministic recall comparison.
- `src/lib/sessionQueue.ts` — keyboard grade ordering and shadow queue behavior.
- `server/app.ts` — Fastify composition and global error handling.
- `server/http/` — domain route validation and responses.
- `server/db/repositories/` — domain persistence, FTS search, due queue, review batches, captures, Topics, chats, audio, and settings.
- `src/features/practice/DrillBar.tsx` — client-side Card Drill sequencing and playback controls.
- `server/services/scheduler.ts` — FSRS-6 integration and project-specific limits.
- `server/services/tutor.ts` — Tutor prompt and read-only tool loop.
- `server/model-routing.ts` — Sol/Terra/Luna workload routing.
- `server/data/seed-content.ts` — curated English and Latvian test material.

## Verification baseline

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

Before a release, verify the actual browser flow at desktop and mobile widths. For installable-PWA work, also run the physical iPhone gate in [MOBILE_APP_DIRECTION.md](MOBILE_APP_DIRECTION.md).

## Current feature baseline

- Practice feed with RU → target recall and target → RU shadowing.
- Instant local answer diff with keyboard-efficient desktop and touch-complete phone grading.
- Editable/deletable cards and persistent Like/Dislike priority.
- Capture Reality transcription with draft review before Library insertion.
- Ordered Topics and configurable Card Drill playback backed by the existing speech cache.
- Configurable OpenAI and ElevenLabs speech with persistent cache and request deduplication.
- Tutor history, uploads, vocabulary context generation, and `Finish & review`.
- Library search, import, review-before-commit, editing, deletion, category/frequency metadata.
- FSRS-6 scheduling, daily progress, backups, restore validation, and periodic model routing checks.

## Next coordinated work

1. Configure the deployment secrets and verify the first release-directory deployment.
2. Add PIN-authenticated Roman and Oliver profiles with isolated SQLite databases.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch order and [OPERATIONS.md](OPERATIONS.md) for production safety.
