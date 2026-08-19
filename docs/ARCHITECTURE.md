# Rehearsal architecture

## Runtime

- React + Vite web client on port 4173.
- Fastify API on port 8787.
- One SQLite database in `.data/rehearsal.sqlite` using WAL and FTS5.
- OpenAI is optional at startup. The API reports capability state via `/health` and `/api/config`.

The Vite dev server proxies `/api` and `/health`. A production build can be served by the Fastify process from `dist`.

Client requests go through one base-path helper. It uses Vite's deployment base by default and supports an explicit `VITE_API_BASE` for a future installed PWA or shell without duplicating endpoint logic.

## Delivery targets

The primary phone target is the existing HTTPS client installed as an iPhone Home Screen PWA with standalone display. App Store distribution and a native rewrite are not required. Client features must remain compatible with a later Capacitor shell, primarily by keeping the API base configurable and isolating browser capability checks from product logic.

The server remains the source of truth in every delivery target. A service worker may cache a versioned application shell and explicitly selected offline assets, but must not blindly cache API mutations, private learning data, or generated audio. See `docs/MOBILE_APP_DIRECTION.md` for interaction constraints and the phone verification gate.

## Client modules

`src/app` composes navigation, language, theme, profile-independent audio, and feature pages. Product behavior belongs to `src/features/<domain>`: Practice, Tutor, Library, Capture, Settings, and Review. `src/shared` contains client configuration and adapters used by more than one feature; feature-specific code must not be moved there for convenience. API shapes shared with the server live in the root `contracts` module.

Styles follow the same ownership boundaries under `src/styles`. `base.css` owns tokens and global controls, domain files own their screens and local responsive states, and `responsive.css` contains cross-domain viewport adjustments. The removed prototype is not a runtime route or architectural fallback.

## Server modules

`server/app.ts` is only the Fastify composition root. Request parsing and responses are grouped by domain in `server/http`; SQL and business state never live in route modules. Persistence is split into `items`, `practice`, `reviews`, `tutor`, `library`, `capture`, `audio`, and `system` repositories under `server/db/repositories`. Services receive only the repository capabilities they use.

Active `.ts` and `.tsx` files are limited to 450 lines and CSS files to 800 lines. `npm run check:architecture` enforces the boundary in CI. Generated-data exceptions require an explicit, documented allowlist entry; there are currently no exceptions.

## Learning data

`items` is the central table. Every entry belongs to exactly one target language and keeps the Russian recall cue, target sentence, accepted alternatives, notes, source, status, quality ratings, tags, and optional embedding.

Related tables store original sources, review batches, capture notes, practice attempts, scheduling state, tutor chats, cached speech, and change events. English and Latvian queries are always filtered before data is returned to the tutor.

`review_batches` is the safety boundary for all LLM-created material. Chat review, vocabulary, imported text, pattern drills, and Capture Reality store candidates as a draft. A user-confirmed commit validates candidate IDs and writes the selected cards in one SQLite transaction.

`capture_notes` stores one Russian voice-note transcript and, only while needed, its uploaded audio BLOB and MIME type. Notes move through `transcribing`, `ready`, `batched`, `processed`, or `failed`. Successful transcription clears the BLOB immediately. Capture commit creates all confirmed cards and marks every source note processed in the same transaction. Review-batch migration rebuilds the SQLite `kind` constraint without discarding existing rows.

`islands` and `island_items` implement user-facing Topics. Membership is many-to-many and may be ordered for Library management. Topic CRUD updates only membership and metadata; deleting an island cascades through `island_items` but never through `items` or `review_state`. Capture commit creates or reuses a Topic from the confirmed category inside the same transaction as the cards.

The one-time `topics_backfill_v1` migration turns each normalized first tag into a Topic, preserving card creation order and every original tag. Normalization ignores case and repeated whitespace. The migration is internally idempotent and records completion in `app_settings`, so a Topic intentionally deleted later is not recreated on restart.

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

Capture Reality records with `MediaRecorder`; it chooses an iPhone-compatible MIME type through `MediaRecorder.isTypeSupported` and uploads multipart audio to Fastify. The server enforces the 25 MB limit and sends completed recordings to `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe` by default). Browser dictation is never used.

## Audio

`/api/audio/speech` calls OpenAI or ElevenLabs TTS and stores the MP3 in the SQLite `audio_cache`. ElevenLabs cache identity includes normalized text, language, voice ID, model, speed, stability, similarity, style, and speaker boost; identical concurrent cache misses share one provider request. Cache entries survive API restarts. Responses include `X-AI-Generated-Audio: true` and `X-Audio-Cache: HIT|MISS`. The browser speech engine is the offline fallback.

`GET /api/audio/elevenlabs/status` verifies that the configured voice ID is reachable and returns safe voice metadata without exposing the API key. The result is held in memory for ten minutes and can be explicitly refreshed from Settings. ElevenLabs speed is validated against its provider range of `0.7–1.2×`; Multilingual v2 omits the unsupported `language_code` field, while Flash v2.5 receives it.

Practice loads the complete language inventory from `/api/items` and the scheduler queue from `/api/practice/due`. The due IDs are a selectable scope and sorting signal rather than an implicit restriction, so every Library card remains available without changing FSRS behavior.

Drill is a client-side sequence over the visible Practice cards. The browser stores manual card order, selected scope, sorting, Topic filters, and loop marks per language. Global Settings and the inline Cards panel edit the same `rehearsal:playback` preference. Its speed is normalized for the selected provider before persistence or playback, so an invalid ElevenLabs value cannot trigger an unintended fallback. A single persistent `<audio>` element requests one card at a time through `/api/audio/speech`, repeats it according to playback preferences, waits for the configured pause, and advances. After the first pass, only loop-marked cards continue.

Topic APIs are `GET /api/islands`, `GET /api/islands/:id`, `POST /api/islands`, `PATCH /api/islands/:id`, and `DELETE /api/islands/:id`. A patch may rename a Topic or replace its ordered membership atomically.

The server stores only individual provider MP3 responses; it does not assemble continuous tracks and has no FFmpeg runtime dependency. Drill updates Media Session metadata for the current card and registers Play, Pause, and Stop handlers when the browser exposes that API.

## Backup and rollback

`npm run db:backup` uses SQLite's online backup API. Restore requires `CONFIRM_RESTORE=1`, validates the selected database, and preserves the current file as `pre-restore-*.sqlite` first.
