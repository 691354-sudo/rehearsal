# Rehearsal architecture

## Runtime

- React + Vite web client on port 4173.
- Fastify API on port 8787.
- One SQLite database in `.data/rehearsal.sqlite` using WAL and FTS5.
- OpenAI is optional at startup. The API reports capability state via `/health` and `/api/config`.

The Vite dev server proxies `/api` and `/health`. A production build can be served by the Fastify process from `dist`.

## Learning data

`items` is the central table. Every entry belongs to exactly one target language and keeps the Russian recall cue, target sentence, accepted alternatives, notes, source, status, quality ratings, tags, and optional embedding.

Related tables store original sources, review batches, practice attempts, scheduling state, tutor chats, cached speech, and change events. English and Latvian queries are always filtered before data is returned to the tutor.

`review_batches` is the safety boundary for all LLM-created material. Chat review, vocabulary, imported text, and pattern drills store candidates as a draft. A user-confirmed commit validates candidate IDs and writes the selected cards in one SQLite transaction.

## Search

Search has two independent signals:

1. SQLite FTS5 over the target, Russian cue, note, and tags.
2. Cosine similarity over 512-dimensional OpenAI embeddings stored as float32 blobs.

When a key is configured, `/api/search` combines both signals and adds a small quality prior. Without a key it remains a fast keyword search. For a personal corpus of a few thousand items, an in-process vector scan is simpler and fast enough.

## LLM access

The conversational tutor uses the Responses API and receives two read-only tools:

- `search_library`
- `list_due_items`

There is no arbitrary SQL tool and no mutation tool in ordinary chat. `Finish & review` and the ingestion endpoints create review batches; only an explicit `Add selected` request can commit them. Arguments are validated with Zod and successful mutations write a before/after event to `change_events`. The tool loop is capped at four rounds per user message.

Routine answer comparison is deterministic and local, so pressing Enter feels immediate. OpenAI handles contextual generation and conversation analysis rather than sitting in the hot recall path.

## Audio

`/api/audio/speech` calls OpenAI TTS and caches the MP3 by a hash of model, voice, speed, language, and text. The response includes `X-AI-Generated-Audio: true`. The browser speech engine is the offline fallback.

## Backup and rollback

`npm run db:backup` uses SQLite's online backup API. Restore requires `CONFIRM_RESTORE=1`, validates the selected database, and preserves the current file as `pre-restore-*.sqlite` first.
