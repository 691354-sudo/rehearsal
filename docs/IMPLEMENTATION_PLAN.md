# Rehearsal — implementation plan

## Product outcome

The application is a private AI language tutor for one student. Its primary job is to start a useful speaking rehearsal immediately: recall a phrase from a Russian cue, shadow a text, listen and repeat, or continue a contextual tutor conversation.

English and Latvian are isolated language spaces. Russian is a cue and explanation language, never part of the learned-content pool.

## Product principles

1. Practice opens first; content management stays secondary.
2. Every useful phrase, correction, or generated variant can be proposed quickly, but enters Library only after explicit selection.
3. The tutor adapts to the student's actual voice, recurring errors, interests, and progress.
4. LLM writes are draft-only; user-confirmed commits are scoped, validated, atomic, and audited.
5. The local database is the source of truth; browser state is only a UI convenience.
6. The phone experience is touch-complete and installable from the iPhone Home Screen without requiring App Store distribution.

## Delivery stages

### Stage 1 — interactive practice shell ✅

- Responsive application navigation and language-space switcher.
- Recall flow: Russian cue → typed answer → inline comparison → next item.
- Shadowing/listening flow using browser speech synthesis as a temporary audio provider.
- Practice presets and detailed playback settings.
- Demo English and Latvian material with local persistence.

Success: the complete interaction can be tested without an account or backend.

### Stage 2 — persistent learning core ✅ for single-user local v1

- SQLite schema for language spaces, sources, learning items, islands, attempts, reviews, chats, audio cache, and change log.
- API repository replacing local persistence behind the same client interface.
- Local private deployment without accounts.
- On-demand consistent backups and a guarded, documented restore procedure.

Success: a reload or second device sees the same content and progress; a backup can be restored.

### Stage 3 — LLM tutor and review workflow ✅

- Chat interface with text and voice input.
- Normal conversational and role-play Tutor without unsolicited line-by-line interruption.
- `Finish & review` proposes corrections, islands, and patterns from the full exchange.
- Shared approval panel for Tutor, vocab lists, text import, and pattern drills.
- No LLM material enters Library without user selection.

Success: a chat correction can become a scheduled practice item without copying text, while the student remains in control of the Library.

### Stage 4 — content ingestion and durable audio ◐

- Paste or upload text, preserve the original, and create an editable processed version.
- Vocabulary triage, contextual anchor sentences, sentence segmentation, contextual notes, and pattern generation.
- Server-generated English and Latvian audio stored in the local database cache.
- Downloadable practice packs and resilient offline playback.

Success: a new text becomes a shadowing session in a few deliberate steps.

### Stage 5 — adaptive daily practice ✅ for the usable single-student loop

- FSRS-based scheduling.
- Separate Recall and Shadowing activity counts and a recall-only daily goal.
- Configurable daily new-card cap; scheduled reviews are never capped.
- Session composition from due phrases, recent errors, active islands, and new material.
- Progress views focused on actions rather than vanity metrics.
- Backup monitoring, restore drill, accessibility, and end-to-end tests.

Success: opening Practice always produces a short, relevant session and explains why each item is present.

### Stage 6 — installable iPhone experience ○

- Web app manifest, standalone display mode, scoped start URL, and production icons.
- Safe-area-aware touch UI that remains usable with the iPhone software keyboard.
- Versioned application-shell caching with explicit offline and update states.
- Recoverable network failures that preserve unsent user work.
- Real-device verification in Safari and Home Screen standalone mode.

Success: Rehearsal can be added to an iPhone Home Screen, launches without browser chrome, and supports the complete daily practice loop by touch. Server-only features fail clearly and recover after connectivity returns.

## Initial data model

- `language_space`
- `content_source`
- `learning_item`
- `review_batch`
- `practice_attempt`
- `review_state`
- `practice_preferences`
- `chat_thread`
- `chat_message`
- `change_event`

The LLM never receives arbitrary database access. Normal Tutor tools are read-only. Generated content passes through review batches and user-confirmed commits.

## Explicitly deferred

- Pronunciation scoring.
- Social features, leaderboards, and public courses.
- App Store distribution and fully native iOS rewrites.
- Capacitor packaging until a concrete native-only capability requires it.
- Multi-user billing and administration.
- Cloud sync and multi-device authentication.
- PostgreSQL migration until the single-user database actually outgrows SQLite.
