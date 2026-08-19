# Rehearsal

A private, practice-first AI tutor for English and Latvian. Its main loop is `Capture → Topic → Drill → Recall`: Russian voice notes become reviewed personal cards, Topics help filter them, Drill speaks the visible cards in order, and Recall schedules the individual cards with FSRS.

## Run locally

```bash
npm install
npm run dev
```

- Web: `http://127.0.0.1:4173/`
- API health: `http://127.0.0.1:8787/health`
- The approved simple interface is now the default. The earlier prototype remains at `/#legacy`.

The browser uses the current Vite base path for API calls by default. Set `VITE_API_BASE=https://example.test/rehearsal` at build time only when the web client and API need different origins.

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
- `gpt-transcribe` for server-side Russian Capture Reality transcription;
- server-side MP3 cache to avoid paying twice for identical speech.

## Connect ElevenLabs

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in the server-side `.env` (or in `.env.elevenlabs` for the production Compose deployment), then restart the API. The browser receives only voice metadata; the API key never leaves the server.

Settings → Voice verifies the configured voice against ElevenLabs and shows its real name and labels. `Quality` uses `eleven_multilingual_v2`; `Fast` uses the lower-cost `eleven_flash_v2_5`. ElevenLabs supports voice speed from `0.7×` to `1.2×`, so the UI and API enforce that range when this provider is selected.

Every generated card MP3 is stored in the persistent SQLite `audio_cache`. The cache identity includes provider, exact text, language, voice ID, model, speed, stability, similarity, style, and speaker boost. An identical request returns `X-Audio-Cache: HIT` and does not call ElevenLabs. Concurrent identical misses are coalesced into one paid API request. A changed phrase or voice setting intentionally creates new audio. Drill plays these cached card files one by one and never builds a combined track.

## Brave on iPhone acceptance

Drill uses one persistent browser audio element but gives every card its own MP3. Before relying on it for a walk, record the device versions and run this physical check:

1. Open Practice, optionally filter several Topics, and press `Start drill`.
2. Lock the iPhone and leave Brave in the background.
3. Confirm playback changes from one card file to the next and continues through pauses for at least 10 minutes.
4. Confirm Play/Pause works on the lock screen.
5. Confirm stopping and restarting resumes a fresh top-to-bottom pass. Upcoming uncached cards require a network connection.

Record the result as `iOS: ____ · Brave: ____ · card transitions: pass/fail · lock controls: pass/fail · date: ____`. This physical pocket test cannot be automated by the desktop test suite.

Models and voice are environment variables, so they can be changed without touching code. TTS audio is identified in the API as AI-generated, and Preview reports whether ElevenLabs generated a new file or played an existing server cache entry.

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

See [docs/METHOD.md](docs/METHOD.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/MOBILE_APP_DIRECTION.md](docs/MOBILE_APP_DIRECTION.md), [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md), and [docs/HANDOFF.md](docs/HANDOFF.md).

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
and restart the container; the key is not included in the image or browser app. ElevenLabs credentials belong in the server-side `.env.elevenlabs`; the container keeps generated speech in the persistent SQLite database mounted from `data/`.
