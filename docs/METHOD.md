# Rehearsal learning method

## Outcome

Rehearsal builds automatic target-language use around each learner's real life. English and Latvian remain available to both profiles; neutral contemporary Vietnamese (`vi-VN`) may be enabled per profile. The interface stays English and every card keeps the direction Russian cue → selected target language. Fluency is treated as a performance skill: useful language is prepared and recalled until delivery no longer requires conscious grammar calculation; material with an approved audio capability is also heard and spoken aloud.

## Content model

The visible unit is always a card. A card can hold a focus word in context, one sentence, a connected language island, or a short paragraph. These are different lengths of material, not separate product systems.

A Topic is a collection of cards around one part of the active learner's real life. “Language island” remains the learning-method term; the product calls the collection a Topic. One card may appear in more than one Topic. Topics filter Practice and Library; deleting a Topic never deletes its cards. A Topic always describes a real-life context such as work, cafés, the gym, or relationships. Linguistic forms such as conditionals and phrasal verbs are patterns or tags, not Topics.

Good material is:

- something the active learner would realistically say;
- a complete, natural utterance rather than an isolated definition;
- current adult language: casual or neutral, without bookish wording, stale idioms, or forced generational slang;
- useful enough to recall and say aloud repeatedly;
- tagged by real-life topic and frequency.

Every generated candidate records a frequency band (`core`, `common`, `specific`, `rare`), currency (`current`, `contextual`, `dated`, `uncertain`), personal fit, naturalness, and commonness. Uncertain slang, idioms, and regional wording may be verified with a low-context web search before being proposed.

Personalization is profile-specific. Roman keeps the established context: a Russian-speaking adult born in 1992 with direct, casual, thoughtful language and familiar life anchors when they genuinely fit. Oliver is configured only as a Russian-speaking adult; the model must not invent his age, interests, work, relationships, location, or lifestyle. Conversation facts supplied by either learner may be used within that conversation.

## Daily loop

The core production cycle is `Capture → Review → Library → Listen & Repeat → Recall → Learned`: capture real Russian thoughts, approve natural target-language cards, hear and shadow selected cards while walking, then retrieve the due cards from memory in writing. FSRS controls future due dates; a small client session queue controls only what returns during the current Recall session.

### Capture Reality

Tutor has a Notebook for thoughts the active learner genuinely wants to express. A note can be typed directly in Russian or recorded freely and transcribed by OpenAI. Typed and transcribed notes enter the same ready queue, may be edited, and may accumulate across days.

`Prepare cards` takes the oldest ready notes within a 50,000-character window, removes repetition, separates ideas, and proposes up to 100 complete, natural utterances with one primary Topic. Active proposals are included by default. Each proposal has its own optional comment. Pressing the review action saves selected proposals whose comments are empty and asks the model to replace only the commented proposals. The replacements remain in the same Review for another decision; a failed request preserves every comment and saves nothing from that request.

Before upload, the browser stores one pending recording per profile and language in IndexedDB. It survives a PWA restart and remains available for Retry or Delete. The browser copy is removed only after the server confirms the upload. Server-side source audio is temporary and is deleted as soon as transcription succeeds; a failed transcription retains it only for Retry or Delete.

### Recall

Recall opens on the complete current FSRS due queue. The compact Topic and count controls are optional adjustments, not a required setup step: the selected Russian prompts are visible immediately below them, and the learner may start without making a choice. The queue may be narrowed to one Topic, 10, 20, 50, or all matching cards, or explicitly switched to Library practice. On desktop, every visible prompt has its own written-answer field and the list reveals more cards in small batches. Focus mode remains available for one finite session. On phones, Recall keeps the one-card focused session because a list of simultaneous text fields is not touch-efficient.

The card shows a natural Russian cue. The learner types the complete target-language version and presses Enter. Comparison is local and immediate. Unicode input is normalized to NFC for persistence and comparison, so canonically equivalent Vietnamese input matches while a missing or incorrect tone remains an error. For languages with approved audio, checking also plays the natural answer for spoken repetition; this automatic playback is enabled by default and may be disabled in Settings. Focus mode keeps a compact Voice settings action beneath the active card; it reveals only the shared Voice, Speed, Repeats, and adaptive-pause summary without leaving the session. The same card shows the submitted answer, the natural answer, their differences, and a manual Play action; an FSRS grade then schedules it. A second Enter accepts the selected grade and advances.

Within the current session, `Again` returns the card after one other card and `Hard` returns it after several others. `Good` and `Easy` complete it for the session. These positions provide immediate reinforcement and do not replace the server's FSRS due date. A failed grade request keeps the answer, comparison, and selected grade available for retry.

Recall is the main memory metric, but Rehearsal has no universal daily quota or streak. The Practice heading shows quiet factual counts such as due now, recalled today, and listened today.

### Listen & Repeat

Listen & Repeat is the second and only other Practice mode. It also opens on the complete current FSRS due queue and shows the selected cards immediately. The learner may play that default queue without configuring it, narrow it by Topic or count, or explicitly switch to all Library cards. The player exposes Play/Pause, Previous, Replay, Next, Stop, Russian reveal, Loop, and explicit Shuffle. Shuffle before playback changes the initial queue; Shuffle during playback finishes the current card and starts a newly mixed round. The saved voice, natural-speed default, and repetition count apply to the whole queue. After every pronunciation, the speaking window equals that MP3's duration plus 0.5 seconds, clamped to 1–15 seconds. Playback changes apply automatically to the next card request; the Russian cue is never spoken.

Once Listen & Repeat starts, Voice settings sit with the transport controls so playback can be adjusted without leaving the active card. The settings remain available before playback for initial setup.

Listen & Repeat is available for English and enabled Vietnamese. Latvian stays written-only in Practice and Library until a voice provider is good enough for it. Vietnamese uses the configured ElevenLabs voice with Flash v2.5 and does not fall back to an English-optimized or random voice. A Vietnamese playback failure keeps the current card and queue in place and exposes Retry.

Every card is requested and played as a separate MP3 through one persistent browser audio element. Starting a queue asks the server to prepare every missing file with three concurrent workers; the priority card plays as soon as it is ready while completed MP3s download into phone memory. `Ready for pocket` reports that in-memory progress. Once the full queue is ready, card transitions no longer need the network. Individual files remain in the profile's SQLite cache across restarts. Cache identity includes normalized text, language, provider, voice, model, speed, and the fixed ElevenLabs tuning, so an identical request never spends provider credits twice while `1.0×` and `1.1×` remain distinct variants. Listen & Repeat never silently replaces a selected ElevenLabs voice with OpenAI or browser speech; a failed card stays in place with Retry. Voice and Playback settings are scoped by profile and language. The ElevenLabs choices are loaded from the account's saved `My Voices`; a built-in list keeps the known voices usable if that lookup is temporarily unavailable. Provider-specific limits are enforced before playback, including ElevenLabs `0.7–1.2×`. Listening activity is recorded once per card per player session; Loop does not duplicate that record, and listening never changes FSRS.

### Learned

`Learned` is an explicit, reversible user decision rather than an automatic FSRS state. Moving a card to Learned disables it for the daily due queue without deleting the card or its review history. Learned cards remain in Library and may be played or reviewed manually. Returning one to learning preserves its schedule and makes it eligible for the due queue again.

Library cards may be selected with checkboxes and deleted as one confirmed batch. The batch operation is atomic: it deletes every selected card or none of them.

A saved Library card may be rewritten from its Edit dialog using one optional learner comment such as “too formal” or “keep the context, but I would say it differently.” The model rewrites only the unsaved editor draft. The stored card, Topic membership, and review history remain unchanged until the learner explicitly presses `Save card`; a failed rewrite preserves both the current draft and the comment for retry.

### Conversation

Tutor behaves like a normal ChatGPT conversation or role-play. It does not interrupt every sentence unless live correction was explicitly requested. Chat and Notebook remain equally visible working modes. Existing chats may be deleted explicitly; opening Tutor restores the active chat at its latest position without replaying an animated scroll through its history. At the end, `Finish & review` analyzes the complete exchange and proposes only meaningful corrections, reusable islands, and patterns.

Tutor Chat accepts either typed messages or a voice message. A voice message records after an explicit microphone action, is transcribed on the server, and sends the transcript immediately. A failed transcription keeps the recording available in the current page for Retry or Delete rather than silently discarding it.

## Approval boundary

LLM output never enters Library automatically. Tutor conversation review, pasted vocabulary, imported text, pattern drills, and Capture Reality all produce a review batch. Ordinary review candidates start unselected; Capture Reality selects active candidates by default so the notebook remains a batch workflow rather than a one-by-one import. The learner may edit, regenerate, change context, exclude, select, or revise a whole capture package. Only the final add action writes cards to Library, atomically.

Raw sources and rejected proposals may be retained for recovery and future analysis, but they are not practice material.

## Vocabulary workflow

For a list of up to roughly 100 words or phrases:

1. Paste or upload the list in Tutor.
2. The system deduplicates and triages entries as active, recognition-only, or skip.
3. Each useful active entry gets one strong personal anchor sentence with a complete Russian cue.
4. Results appear in pages of eight. The learner can request another version or a different context.
5. Only selected cards enter Library.
6. The daily new-card limit (10 by default) limits the FSRS `Due now` queue; all Library cards remain available for custom Recall and Listen & Repeat.

## Pattern drills

A Library card can generate a short substitution drill. Variants change one meaningful slot while retaining the useful structure or collocation. They are temporary proposals; only selected variants become cards.

## Scheduling

Recall uses `ts-fsrs` (FSRS-6) with short learning and relearning steps. Like, neutral, and dislike preferences modify retention targets and maximum intervals. The default caps are deliberately short for active speech: 60, 180, and 365 days rather than multi-year flashcard horizons. Scheduled reviews are never hidden by the daily new-card cap.

The server database is the only source of learning content, schedules, and Learned state. If it is unavailable, the client shows a recoverable unavailable state and never substitutes demo cards for personal data. Typed Recall answers, Tutor drafts, recordings, edits, and review actions remain recoverable after a failed request.

## Model routing

- Sol: natural Tutor conversation.
- Terra: conversation review, contextual generation, pattern drills, and other tasks requiring judgment.
- Luna: high-volume utility work and currentness checks.

These role assignments are pinned. `npm run models:check` can manually verify the configured IDs with small canary requests before a deliberate model change; it never discovers, selects, or writes new runtime models. Prompt sources, Tutor history, individual messages, and output tokens have hard server-side budgets.

## Deferred on purpose

Pronunciation scoring, App Store distribution, fully native mobile rewrites, offline packs, public account registration, and administration are not current requirements. The phone delivery is the installed Home Screen PWA in standalone mode; interaction and layout rules live in `docs/MOBILE_APP_DIRECTION.md`.
