# Rehearsal current handoff

This file contains only current state and follow-up work. Every new session starts with [AGENTS.md](../AGENTS.md); do not copy canonical product, architecture, collaboration, mobile, or operations rules here.

## Current state

- The active `DesignLab.tsx` UI includes Practice, Tutor, Library, Settings, Capture Reality, Topics, and Saturation. The older prototype remains at `#legacy` until the modularization PR removes it.
- The API currently opens one SQLite database at `.data/rehearsal.sqlite` locally and `/opt/apps/rehearsal/data/rehearsal.sqlite` in production.
- Production is healthy at `https://7662n.cc/rehearsal/` and still uses a directly managed application directory rather than release artifacts.
- Deterministic tests and the production build pass without paid API calls.

## Main code map

- `src/components/DesignLab.tsx` — current application shell and primary flows.
- `src/components/CaptureNotebook.tsx` — Russian voice capture and reviewed card preparation.
- `src/components/TopicsManager.tsx` — reusable Topic ordering.
- `src/components/SaturationPanel.tsx` — continuous walking-audio preparation and playback.
- `src/components/design-lab.css` — current responsive design system and component states.
- `src/lib/compare.ts` — instant deterministic recall comparison.
- `src/lib/sessionQueue.ts` — keyboard grade ordering and shadow queue behavior.
- `server/app.ts` — HTTP API and validation.
- `server/db/repository.ts` — SQLite persistence, FTS search, changes, due queue, review batches, captures, topics, and saturation.
- `server/services/saturation.ts` — continuous audio assembly.
- `server/services/scheduler.ts` — FSRS-6 integration and project-specific limits.
- `server/services/tutor.ts` — Tutor prompt and read-only tool loop.
- `server/model-routing.ts` — Sol/Terra/Luna workload routing.

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
- Ordered Topics and cached continuous Saturation audio.
- Configurable OpenAI and ElevenLabs speech with persistent cache and request deduplication.
- Tutor history, uploads, vocabulary context generation, and `Finish & review`.
- Library search, import, review-before-commit, editing, deletion, category/frequency metadata.
- FSRS-6 scheduling, daily progress, backups, restore validation, and periodic model routing checks.

## Next coordinated work

1. Replace direct production updates with GitHub release-directory deployment.
2. Split the active UI, API routes, and repositories into feature/domain modules and remove `#legacy` without losing Capture, Topics, or Saturation.
3. Add PIN-authenticated Roman and Oliver profiles with isolated SQLite databases.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch order and [OPERATIONS.md](OPERATIONS.md) for production safety.
