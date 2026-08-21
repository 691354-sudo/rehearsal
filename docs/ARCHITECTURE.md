# Rehearsal architecture

## Runtime

- React + Vite web client on port 4173.
- Fastify API on port 8787.
- Two isolated SQLite databases in `.data/profiles/roman.sqlite` and `.data/profiles/oliver.sqlite`, both using WAL and FTS5.
- OpenAI is optional at startup. The API reports capability state via `/health` and `/api/config`.

The Vite dev server proxies `/api` and `/health`. In production, Fastify serves `dist`; the installed PWA and API therefore share one origin and the same Vite deployment base path. Client requests go through one base-path helper, and separate client/API origins are not supported.

## Delivery targets

The primary phone target is the existing HTTPS client installed as an iPhone Home Screen PWA with standalone display. App Store distribution, a native rewrite, and a separate desktop or iPhone shell are not current targets.

The server remains the source of truth. The service worker precaches only the versioned application shell and static build assets; it does not cache API mutations, private learning data, or generated audio. See `docs/MOBILE_APP_DIRECTION.md` for interaction constraints and the phone verification gate.

## Client modules

`src/features/auth` owns the profile gate and session bootstrap. `src/app` composes navigation, language, theme, and feature pages after authentication. `src/features/practice/useLearningData.ts` owns loading and mutation of learning data; `src/features/audio/usePlaybackController.ts` owns speech playback and provider fallback. Product behavior belongs to `src/features/<domain>`: Practice and Listen & Repeat, Tutor and Capture, Library and Topics, Settings, and Review. `src/shared` contains client configuration and adapters used by more than one feature; feature-specific code must not be moved there for convenience. API shapes shared with the server live in the root `contracts` module.

The browser keeps no session credential in `localStorage`. The signed session and CSRF cookies are server-managed, while the matching CSRF token stays in memory. Theme and Tutor thread selection use keys namespaced by the authenticated profile; playback settings are namespaced by profile and language. English reads the legacy profile-only playback key once when no language-specific value exists. Runtime Library and Practice data is never replaced with client seed content when the API is unavailable; already loaded per-language snapshots remain visible with an explicit retry state. Changing language stops playback and aborts the previous language's in-flight learning-data requests.

IndexedDB stores at most one unsent Capture recording per profile and language. The Blob is written before upload and removed only after the server confirms success or the user explicitly deletes it. Private learning data, API responses, generated audio, and credentials are not placed in offline storage.

Styles follow the same ownership boundaries under `src/styles`. `base.css` owns tokens and global controls, domain files own their screens and local responsive states, and `responsive.css` contains cross-domain viewport adjustments. The removed prototype is not a runtime route or architectural fallback.

## Server modules

`server/app.ts` is only the Fastify composition root. Request parsing and responses are grouped by domain in `server/http`; SQL and business state never live in route modules. Persistence is split into `items`, `practice`, `reviews`, `tutor`, `library`, `capture`, `audio`, and `system` repositories under `server/db/repositories`. Services receive only the repository capabilities they use.

`server/profiles` owns the fixed Roman/Oliver registry and database lifecycle. A verified signed cookie binds every non-auth `/api` request to one profile context; the server then selects that profile's repository. Client input can never select a database path. Once the registry exists, a missing profile database fails startup with a restore instruction; it is never silently recreated or copied. A first-ever initialization creates both databases as one set before publishing the registry. `server/auth` owns PIN verification, login throttling, cookie sessions, logout, and CSRF enforcement.

Active `.ts` and `.tsx` files are limited to 450 lines and CSS files to 800 lines. `npm run check:architecture` enforces the boundary in CI. Generated-data exceptions require an explicit, documented allowlist entry; there are currently no exceptions.

## Learning data

Each profile database has the same schema and no cross-profile tables. `items` is the central table. Every entry belongs to exactly one target language and keeps the Russian recall cue, target sentence, accepted alternatives, notes, source, status, quality ratings, tags, and optional embedding.

Related tables store original sources, review batches, capture notes, practice attempts, scheduling state, tutor chats, cached speech, and change events. The `languages.enabled` flag is profile-local: disabling a language removes it from the session and configuration response without deleting cards, FSRS state, Topics, Tutor history, statistics, or audio cache. Direct-language requests and item, Topic, thread, review-batch, or Capture IDs resolve through the same availability guard and return `403 LANGUAGE_NOT_ENABLED` before domain work. Every learning query remains filtered by language before data is returned to the tutor.

`schema_migrations` records ordered, one-time SQLite structure changes. Every pending migration runs in a transaction, checks foreign-key integrity and SQLite `quick_check`, and records its ID only after success. Migration `005-vietnamese-language` rebuilds the language constraint, preserves existing rows, adds the availability flag, and inserts disabled `vi / Vietnamese / vi-VN`. Startup closes the database and fails if schema initialization or migration fails. Domain backfills that are not schema changes retain their own explicit completion markers.

`review_batches` is the safety boundary for all LLM-created material. Chat review, vocabulary, imported text, pattern drills, and Capture Reality store candidates as a draft. A user-confirmed commit validates candidate IDs and writes the selected cards in one SQLite transaction. Capture Review may resolve a draft incrementally through `/api/review-batches/:id/resolve-capture`: uncommented selected candidates commit in the request transaction, while the model replaces only candidates carrying per-card comments and keeps those replacements in the same draft. Source notes become `processed` only when no revised candidates remain.

`capture_notes` stores one Russian thought. A typed note is created directly as `ready`; a voice note stores its transcript and, only while needed, its uploaded audio BLOB and MIME type. Notes move through `transcribing`, `ready`, `batched`, `processed`, or `failed`. Successful transcription clears the BLOB immediately. Capture commit creates all confirmed cards and marks every source note processed in the same transaction. Review-batch migration rebuilds the SQLite `kind` constraint without discarding existing rows.

`islands` and `island_items` implement user-facing Topics. Membership is many-to-many. Stored membership order is an implementation detail and is not exposed as a learning control. Topic CRUD updates only membership and metadata; deleting an island cascades through `island_items` but never through `items` or `review_state`. Capture commit creates or reuses a Topic from the confirmed category inside the same transaction as the cards.

Practice and Library use `islands` membership as the only source of Topic filtering. Item tags remain searchable metadata for patterns, source, and linguistic form, but `tags[0]` does not define a Topic. `practice_enabled = 0` is the reversible Learned state: due queries exclude it while Library inventory and review history retain it.

Library bulk deletion sends up to 500 unique item public IDs in one authenticated request. The repository verifies the complete set before deleting inside one SQLite transaction, so a stale or invalid selection cannot produce a partial delete.

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

`POST /api/items/:itemId/rewrite` accepts the current editor draft and one bounded learner comment, then returns a rewritten target, Russian cue, and optional note. It never mutates the item. The client places the proposal back into the existing Edit dialog, and only the ordinary authenticated item patch persists it, preserving the explicit approval boundary and all existing Topic and FSRS state.

Workload roles are pinned: Sol for Tutor conversation, Terra for material generation and review, and Luna for small utility tasks. Model changes are manual and may be canary-checked with `npm run models:check`; runtime configuration is never rewritten automatically. Roman receives the existing personal context, while Oliver receives only a neutral Russian-speaking-adult persona and an instruction not to invent personal facts. Source text, Tutor history, individual messages, and model output are bounded before provider calls.

Capture Reality records with `MediaRecorder`; it chooses an iPhone-compatible MIME type through `MediaRecorder.isTypeSupported` and uploads multipart audio to Fastify. An unsent recording stays in profile-and-language-scoped IndexedDB until the server accepts its client-generated UUID; retrying that UUID is idempotent. The server enforces the 25 MB limit and sends completed recordings to `OPENAI_TRANSCRIBE_MODEL` (`gpt-transcribe` by default). `POST /api/captures/text` creates an equivalent ready note without transcription. Browser dictation is never used.

Tutor voice messages reuse the compatible `MediaRecorder` formats but post transient audio to `/api/chat/transcribe`. The audio exists only for that request, is never stored in the profile database, and the returned transcript enters the ordinary `/api/chat` path. If transcription fails, the browser keeps the Blob in memory for Retry or explicit Delete while that Tutor page remains open.

## Audio

`/api/audio/speech` calls OpenAI `tts-1-hd` with a compatible legacy voice or ElevenLabs TTS and stores the MP3 in the SQLite `audio_cache`. ElevenLabs cache identity includes NFC-normalized text, language, voice ID, model, speed, stability, similarity, style, and speaker boost; identical concurrent cache misses share one provider request. Cache entries survive API restarts. Responses include `X-AI-Generated-Audio: true` and `X-Audio-Cache: HIT|MISS`. English retains the existing fallback chain. Vietnamese requires ElevenLabs Flash v2.5, sends `language_code: vi`, and fails without advancing the current queue when that voice cannot be played.

`GET /api/config` loads the account's saved ElevenLabs `My Voices` through the server-side API key, follows provider pagination, and caches the safe ID/name list in memory for ten minutes. A failed lookup returns the built-in known voices instead of blocking the application. `GET /api/audio/elevenlabs/status` verifies that the selected voice ID is reachable and returns safe voice metadata without exposing the API key. Results are held in memory by voice for ten minutes and can be explicitly refreshed from Settings. ElevenLabs speed is validated against its provider range of `0.7–1.2×`; Multilingual v2 omits the unsupported `language_code` field, while Flash v2.5 receives it.

Practice loads the language inventory from `/api/items?includeSchedule=true` and the ordered current scheduler queue from `/api/practice/due`. Both Practice modes derive their initial visible selection from those ordered due IDs and render it before a session starts. Desktop Recall can evaluate and grade each visible row directly, loading the long preview in small client-side batches; Focus mode creates a finite session from the same selection. Narrow screens keep only Focus mode inputs. FSRS remains the source of future due dates; the focused client queue only brings `Again` and `Hard` cards back during the current session. Library cards, including Learned cards, remain available only after an explicit switch to custom practice.

Listen & Repeat is a client-side sequence over the visible due or custom selection, optionally narrowed by Topic and count. Global Settings and inline player controls edit the active profile-and-language playback preference immediately; it also stores whether Recall plays the natural answer automatically after checking. A playback change affects the next card request and does not restart audio already playing. Its speed is normalized for the selected provider before persistence or playback, so an invalid ElevenLabs value cannot trigger an unintended fallback. Browser audio requests one card at a time through `/api/audio/speech`, reuses one audio element, repeats it according to playback preferences, waits for the configured pause, and advances.

The client exposes this audio path through language capabilities: English and enabled Vietnamese expose Play and Listen & Repeat; Latvian Practice resolves to Recall and does not initiate TTS. Vietnamese target fields carry `lang="vi"` and use the locally bundled Vietnamese and Latin subsets of Noto Sans Variable, while the English interface and Russian cues keep Golos Text.

Topic APIs are `GET /api/islands`, `GET /api/islands/:id`, `POST /api/islands`, `PATCH /api/islands/:id`, and `DELETE /api/islands/:id`. A patch may rename a Topic or replace its ordered membership atomically. The client exposes adding a card to another Topic, removing it from the current Topic, and a recoverable two-patch move between Topics; failure after the destination update leaves the card in both Topics rather than losing membership.

Tutor history uses `GET /api/chat/threads`, `GET /api/chat/:threadId/messages`, and `DELETE /api/chat/:threadId`. Deleting a thread cascades to its messages inside the profile database. Loaded history is positioned immediately; smooth scrolling is reserved for new messages and newly prepared review content.

The Tutor composer has its own upward resize handle at the right edge; the textarea has no fixed maximum height. On narrow layouts the chat fills the space between the app header and bottom navigation, and a larger composer expands upward before the page itself grows.

The server stores only individual provider MP3 responses; it does not assemble continuous tracks and has no FFmpeg runtime dependency. Listen & Repeat updates Media Session metadata for the current card and registers Play, Pause, Previous, Next, and Stop handlers when the browser exposes that API.

The installed PWA precaches only the versioned application shell and static build assets. `/api`, `/health`, loaded learning data, and generated audio are network-only; the only durable private offline payload is an unsent Capture recording in IndexedDB. Loading the cached shell without the API keeps already loaded in-memory cards visible and shows an explicit unavailable state rather than synthetic learning data.

## Backup and rollback

`npm run db:backup` uses SQLite's online backup API and writes separate Roman and Oliver backups. Restore requires an explicit `--profile`, requires `CONFIRM_RESTORE=1`, validates the candidate, and preserves only the selected profile database as `pre-restore-<profile>-*.sqlite` first.
