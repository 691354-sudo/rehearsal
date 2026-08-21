# Rehearsal current handoff

This file contains only current state and follow-up work. Start with [AGENTS.md](../AGENTS.md); canonical behavior, architecture, collaboration, mobile, and operations rules live in their named documents.

## Current state

- Roman and Oliver authenticate through fixed PIN profiles with independent SQLite databases, Library data, Tutor history, scheduling, settings, audio cache, and backups.
- An initialized registry fails closed if either profile database disappears. Ordered schema migrations run once through `schema_migrations`.
- LLM roles are pinned to Sol, Terra, and Luna. Roman retains the established personal context; Oliver receives a neutral persona. Prompt and output budgets are enforced, and model checks are manual.
- English and Latvian remain enabled by default. Vietnamese support is profile-gated and migrates in disabled; the first intended enablement is Oliver only.
- ElevenLabs remains the primary configured English voice. Vietnamese requires its configured ElevenLabs voice with Flash v2.5 and has no automatic English or browser fallback.
- The PWA keeps already loaded cards visible during network loss and stores one unsent Capture recording per profile and language in IndexedDB until server confirmation.
- Library supports checkbox multi-selection with atomic batch deletion. Tutor Chat supports transient voice transcription with in-page Retry/Delete recovery and an upward-resizing composer. Listen & Repeat prepares per-card MP3s into phone memory, reports pocket readiness, and supports explicit Loop, Shuffle, and adaptive speaking pauses.
- The client shell delegates learning data and audio playback to feature hooks. Server tests are split by domain, legacy repository wrappers are gone, and TypeScript rejects unused locals and parameters.
- Production uses immutable CI-checked releases and separate verified profile backups. No production application files are edited manually.

## Main code map

- `src/app/RehearsalApp.tsx` — authenticated shell and page composition.
- `src/features/practice/useLearningData.ts` — learning-data loading and mutations.
- `src/features/audio/usePlaybackController.ts` — audio playback and provider fallback.
- `src/features/capture/pendingRecordings.ts` — durable local recording recovery.
- `src/features/` — Practice, Tutor, Library, Capture, Settings, and Review behavior.
- `server/app.ts` and `server/http/` — Fastify composition and domain routes.
- `server/db/database.ts` — database opening and ordered schema migrations.
- `server/db/repositories/` — domain persistence.
- `server/profiles/` and `server/auth/` — fixed profiles, database selection, login, sessions, and CSRF.
- `server/services/learner-persona.ts` — profile-aware LLM context.
- `server/services/ai-limits.ts` — provider input and output budgets.
- `server/services/tutor.ts` — Tutor prompt and read-only tool loop.

## Verification baseline

```bash
cd "/Users/working/Documents/ChatGPT/English site"
npm install
OPENAI_API_KEY= ELEVENLABS_API_KEY= npm test
npm run build
npm run check:architecture
```

The focused API suites cover authorization, profile isolation, Practice, Tutor, Capture and Review, uploads, and audio. Browser acceptance covers Roman and Oliver login, switching, Practice, Tutor, Library, Notebook, visible connection failure, and recovery. A real iPhone remains required for Safari/Home Screen relaunch, microphone persistence, software-keyboard, and locked-screen audio checks described in [MOBILE_APP_DIRECTION.md](MOBILE_APP_DIRECTION.md).

## Next coordinated work

1. After the Vietnamese-capable release is healthy, configure the existing Vietnamese ElevenLabs voice, obtain separate approval for one paid smoke test, and only then enable `vi` for Oliver with the documented command.
2. Run the physical iPhone acceptance gate for the Vietnamese keyboard, diacritics, Recall, Safari/Home Screen playback, Media Session, locked-screen audio, and network-error recovery.
3. Keep the archived legacy database and pre-enable profile backups until Roman and Oliver complete production acceptance.
4. On a physical iPhone in Brave, run a 20-card Listen & Repeat stack for at least three locked-screen loops and flag any transition longer than its adaptive pause plus two seconds.
5. Treat `focusTerms` highlighting in cards as a separate UI task; the stored data already exists.
