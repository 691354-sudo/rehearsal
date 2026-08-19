# Rehearsal architecture

## Runtime

- React + Vite web client on port 4173.
- Fastify API on port 8787.
- Two isolated SQLite databases in `.data/profiles/roman.sqlite` and `.data/profiles/oliver.sqlite`, both using WAL and FTS5.
- OpenAI is optional at startup. The API reports capability state via `/health` and `/api/config`.

The Vite dev server proxies `/api` and `/health`. A production build can be served by the Fastify process from `dist`.

Client requests go through one base-path helper. It uses Vite's deployment base by default and supports an explicit `VITE_API_BASE` for a future installed PWA or shell without duplicating endpoint logic.

## Delivery targets

The primary phone target is the existing HTTPS client installed as an iPhone Home Screen PWA with standalone display. App Store distribution and a native rewrite are not required. Client features must remain compatible with a later Capacitor shell, primarily by keeping the API base configurable and isolating browser capability checks from product logic.

The server remains the source of truth in every delivery target. A service worker may cache a versioned application shell and explicitly selected offline assets, but must not blindly cache API mutations, private learning data, or generated audio. See `docs/MOBILE_APP_DIRECTION.md` for interaction constraints and the phone verification gate.

## Client modules

`src/features/auth` owns the profile gate and session bootstrap. `src/app` composes navigation, language, theme, audio, and feature pages after authentication. Product behavior belongs to `src/features/<domain>`: Practice and Listen & Repeat, Tutor and Capture, Library and Topics, Settings, and Review. `src/shared` contains client configuration and adapters used by more than one feature; feature-specific code must not be moved there for convenience. API shapes shared with the server live in the root `contracts` module.

The browser keeps no session credential in `localStorage`. The signed session and CSRF cookies are server-managed, while the matching CSRF token stays in memory. Language, theme, playback settings, and Tutor thread selection use keys namespaced by the authenticated profile. Runtime Library and Practice data is never replaced with client seed content when the API is unavailable.

Styles follow the same ownership boundaries under `src/styles`. `base.css` owns tokens and global controls, domain files own their screens and local responsive states, and `responsive.css` contains cross-domain viewport adjustments. The removed prototype is not a runtime route or architectural fallback.

## Server modules

`server/app.ts` is only the Fastify composition root. Request parsing and responses are grouped by domain in `server/http`; SQL and business state never live in route modules. Persistence is split into `items`, `practice`, `reviews`, `tutor`, `library`, `capture`, `audio`, and `system` repositories under `server/db/repositories`. Services receive only the repository capabilities they use.

`server/profiles` owns the fixed Roman/Oliver registry and database lifecycle. A verified signed cookie binds every non-auth `/api` request to one profile context; the server then selects that profile's repository. Client input can never select a database path. `server/auth` owns PIN verification, login throttling, cookie sessions, logout, and CSRF enforcement.

Active `.ts` and `.tsx` files are limited to 450 lines and CSS files to 800 lines. `npm run check:architecture` enforces the boundary in CI. Generated-data exceptions require an explicit, documented allowlist entry; there are currently no exceptions.

## Learning data

Each profile database has the same schema and no cross-profile tables. `items` is the central table. Every entry belongs to exactly one target language and keeps the Russian recall cue, target sentence, accepted alternatives, notes, source, status, quality ratings, tags, and optional embedding.

Related tables store original sources, review batches, capture notes, practice attempts, scheduling state, tutor chats, cached speech, and change events. English and Latvian queries are always filtered before data is returned to the tutor.

`review_batches` is the safety boundary for all LLM-created material. Chat review, vocabulary, imported text, pattern drills, and Capture Reality store candidates as a draft. A user-confirmed commit validates candidate IDs and writes the selected cards in one SQLite transaction.

`capture_notes` stores one Russian thought. A typed note is created directly as `ready`; a voice note stores its transcript and, only while needed, its uploaded audio BLOB and MIME type. Notes move through `transcribing`, `ready`, `batched`, `processed`, or `failed`. Successful transcription clears the BLOB immediately. Capture commit creates all confirmed cards and marks every source note processed in the same transaction. Review-batch migration rebuilds the SQLite `kind` constraint without discarding existing rows.

`islands` and `island_items` implement user-facing Topics. Membership is many-to-many and may be ordered for Library management. Topic CRUD updates only membership and metadata; deleting an island cascades through `island_items` but never through `items` or `review_state`. Capture commit creates or reuses a Topic from the confirmed category inside the same transaction as the cards.

Practice and Library use `islands` membership as the only source of Topic filtering. Item tags remain searchable metadata for patterns, source, and linguistic form, but `tags[0]` does not define a Topic. `practice_enabled = 0` is the reversible Learned state: due queries exclude it while Library inventory and review history retain it.

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

Capture Reality records with `MediaRecorder`; it chooses an iPhone-compatible MIME type through `MediaRecorder.isTypeSupported` and uploads multipart audio to Fastify. The server enforces the 25 MB limit and sends completed recordings to `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe` by default). `POST /api/captures/text` creates an equivalent ready note without transcription. Browser dictation is never used.

## Audio

`/api/audio/speech` calls OpenAI or ElevenLabs TTS and stores the MP3 in the SQLite `audio_cache`. ElevenLabs cache identity includes normalized text, language, voice ID, model, speed, stability, similarity, style, and speaker boost; identical concurrent cache misses share one provider request. Cache entries survive API restarts. Responses include `X-AI-Generated-Audio: true` and `X-Audio-Cache: HIT|MISS`. The browser speech engine is the offline fallback.

`GET /api/audio/elevenlabs/status` verifies that the configured voice ID is reachable and returns safe voice metadata without exposing the API key. The result is held in memory for ten minutes and can be explicitly refreshed from Settings. ElevenLabs speed is validated against its provider range of `0.7–1.2×`; Multilingual v2 omits the unsupported `language_code` field, while Flash v2.5 receives it.

Practice loads the language inventory from `/api/items?includeSchedule=true` and the current scheduler queue from `/api/practice/due`. Recall defaults to a finite session created from due items. FSRS remains the source of future due dates; the client queue only brings `Again` and `Hard` cards back during the current session. All non-Learned Library cards remain available for explicit custom practice.

Listen & Repeat is a client-side sequence over an explicitly selected Topic and count. Global Settings and inline player controls edit the same `rehearsal:playback` preference. Its speed is normalized for the selected provider before persistence or playback, so an invalid ElevenLabs value cannot trigger an unintended fallback. Browser audio requests one card at a time through `/api/audio/speech`, repeats it according to playback preferences, waits for the configured pause, and advances. Browser speech is the usable whole-session fallback when AI speech is unavailable.

The client exposes this audio path for English only. Latvian Practice resolves to Recall, and Latvian Library cards do not expose Play; no Latvian TTS request is initiated by the application UI.

Topic APIs are `GET /api/islands`, `GET /api/islands/:id`, `POST /api/islands`, `PATCH /api/islands/:id`, and `DELETE /api/islands/:id`. A patch may rename a Topic or replace its ordered membership atomically.

The server stores only individual provider MP3 responses; it does not assemble continuous tracks and has no FFmpeg runtime dependency. Listen & Repeat updates Media Session metadata for the current card and registers Play, Pause, Previous, Next, and Stop handlers when the browser exposes that API.

An installable PWA may precache only the versioned application shell and static build assets. `/api`, `/health`, private learning data, and generated audio are network-only. Loading the cached shell without the API produces an explicit unavailable state rather than cached or synthetic learning data.

## Backup and rollback

`npm run db:backup` uses SQLite's online backup API and writes separate Roman and Oliver backups. Restore requires an explicit `--profile`, requires `CONFIRM_RESTORE=1`, validates the candidate, and preserves only the selected profile database as `pre-restore-<profile>-*.sqlite` first.
