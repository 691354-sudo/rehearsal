# Rehearsal

Private English, Latvian, Vietnamese, and Norwegian Bokmål practice. Every PIN profile has its own SQLite database, Library, Tutor history, settings, review schedule, audio cache, and backups. Existing learners can create a one-time invitation for a new empty profile; there is no open registration. The interface remains English; learning cards use Russian cues and the selected target language.

The main loop is `Capture → Review → Library → Listen & Repeat → Recall → Learned`. Russian notes become reviewed target-language cards; FSRS schedules recall, while Listen & Repeat handles languages with an approved audio capability.

## Local development

Requires Node 24.

```bash
npm install
cp .env.example .env
npm run dev
```

Set different local profile PINs and a random `SESSION_SECRET` in the untracked `.env` before the first start.

- Web: `http://127.0.0.1:4173/`
- API health: `http://127.0.0.1:8787/health`
- Isolated Codex browser environment: `npm run dev:codex`

The installed PWA and API use the same origin and deployment base path. OpenAI and ElevenLabs are optional: Recall comparison and FTS search stay local, and ordinary previews may fall back to browser speech. Listen & Repeat keeps its selected server voice strict so a failed ElevenLabs card is never silently pronounced by another provider.

## AI and speech

Server-side defaults are deliberately pinned by workload:

- `gpt-5.6-sol` — Tutor conversation;
- `gpt-5.6-terra` — material generation and review;
- `gpt-5.6-luna` — small utility tasks;
- `text-embedding-3-small` — semantic search;
- `gpt-transcribe` — Russian voice-note transcription;
- `tts-1-hd` with `onyx` — OpenAI speech fallback;
- ElevenLabs — language-verified English voices and the required Vietnamese or Norwegian voice when configured.

Model changes are manual. After deliberately changing model environment variables, run `npm run models:check`; the command makes small canary requests but never rewrites application configuration.

All LLM material remains a draft until the user confirms it. Prompt sources, Tutor history, individual messages, and model output have server-side size limits. API keys never reach browser JavaScript.

## Data and checks

```bash
npm run db:backup
CONFIRM_RESTORE=1 npm run db:restore -- --profile roman /absolute/path/to/backup.sqlite
OPENAI_API_KEY= ELEVENLABS_API_KEY= npm test
npm run build
npm run check:architecture
npm run check:styles
```

Once a profile registry exists, a missing registered database stops startup and requires restoring that named profile. It is never silently recreated or copied from legacy data. Schema changes run once and are recorded in `schema_migrations`.

## Canonical documentation

- [AGENTS.md](AGENTS.md) — starting point and repository rules
- [docs/METHOD.md](docs/METHOD.md) — product and learning behavior
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — code and data boundaries
- [docs/MOBILE_APP_DIRECTION.md](docs/MOBILE_APP_DIRECTION.md) — installed PWA and phone constraints
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — branch, PR, and merge workflow
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — production, backups, restore, and recovery
- [docs/HANDOFF.md](docs/HANDOFF.md) — current short-lived status

Production runs at `https://7662n.cc/rehearsal/` and receives only CI-checked commits merged through GitHub.
