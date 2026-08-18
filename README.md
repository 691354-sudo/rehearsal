# Rehearsal

A private, practice-first AI tutor for English and Latvian. The current vertical slice includes instant recall, configurable shadowing, a persistent editable library, vocabulary and text review batches, a conversational LLM tutor, FSRS scheduling, hybrid search, audio caching, and database backups.

## Run locally

```bash
npm install
npm run dev
```

- Web: `http://127.0.0.1:4173/`
- API health: `http://127.0.0.1:8787/health`
- The approved simple interface is now the default. The earlier prototype remains at `/#legacy`.

The app works without an OpenAI key: recall uses local comparison, search uses FTS5, and audio falls back to the browser voice. The database and imported sources still persist.

## Connect OpenAI

Open `.env` and set:

```dotenv
OPENAI_API_KEY=your_key_here
```

Then restart `npm run dev`. The key is read only by the API process and is never shipped to browser JavaScript.

Configured OpenAI capabilities:

- instant local comparison for routine recall, without an LLM round trip;
- Responses API read tools for scoped library search; generated content is draft-only until selected;
- `gpt-5.6-sol` for the natural Tutor conversation;
- `gpt-5.6-luna` for high-volume utility work and currentness checks;
- `gpt-5.6-terra` for contextual generation, categorization, and full-chat review;
- `text-embedding-3-small` for semantic search (512 dimensions by default);
- `gpt-4o-mini-tts` for English, Latvian, and Russian audio;
- server-side MP3 cache to avoid paying twice for identical speech.

Models and voice are environment variables, so they can be changed without touching code. TTS audio is identified in the API as AI-generated.

The workload router is refreshed every 14 days. It lists the models available to
the configured API account, selects the newest Sol/Terra/Luna IDs, verifies each
with a small canary request, and atomically writes `.data/model-routing.json`.
The running API reads that file at request time, so a successful refresh does not
need a rebuild. A failed check leaves the last working routing untouched.

```bash
npm run models:check -- --force
```

## Data and backups

The single-user v1 uses SQLite with WAL and FTS5. The database lives at `.data/rehearsal.sqlite`. It contains the original imported sources, curated items, embeddings, attempts, review state, tutor chats, islands, cached audio, and an append-only change log.

```bash
npm run db:seed
npm run db:backup
CONFIRM_RESTORE=1 npm run db:restore -- /absolute/path/to/backup.sqlite
```

Restore validates the candidate with SQLite `quick_check` and creates a safety copy of the current database before replacing it. Stop the API before restoring.

To generate embeddings after adding a key:

```bash
npm run db:embed
```

See [docs/METHOD.md](docs/METHOD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), and [docs/HANDOFF.md](docs/HANDOFF.md).

## Production

The current private deployment runs at `https://7662n.cc/rehearsal/` from
`/opt/apps/rehearsal` on the server. Docker binds the Fastify process only to
`127.0.0.1:8788`; nginx terminates HTTPS and removes the `/rehearsal/` prefix.

```bash
docker compose -f compose.production.yml up -d --build
docker compose -f compose.production.yml ps
curl http://127.0.0.1:8788/health
```

Persistent data is mounted from `data/` and backups from `backups/`. The server
cron file in `deploy/rehearsal-backup.cron` creates a consistent SQLite backup
each night and removes backup files older than 30 days. The daily cron entry in
`deploy/rehearsal-model-check.cron` invokes the model checker; its internal
timestamp guard performs the live check only once every 14 days. To enable Tutor,
embeddings, and OpenAI speech, set `OPENAI_API_KEY` in the server-side `.env`
and restart the container; the key is not included in the image or browser app.
