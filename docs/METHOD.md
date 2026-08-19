# Rehearsal learning method

## Outcome

Rehearsal builds automatic English and Latvian around one student's real life. Fluency is treated as a performance skill: useful language is prepared and recalled until delivery no longer requires conscious grammar calculation; supported English material is also heard and spoken aloud.

## Content model

The visible unit is always a card. A card can hold a focus word in context, one sentence, a connected language island, or a short paragraph. These are different lengths of material, not separate product systems.

A Topic is a collection of cards around one part of Roman's real life. “Language island” remains the learning-method term; the product calls the collection a Topic. One card may appear in more than one Topic. Topics filter Practice and Library; deleting a Topic never deletes its cards. A Topic always describes a real-life context such as work, cafés, the gym, or relationships. Linguistic forms such as conditionals and phrasal verbs are patterns or tags, not Topics.

Good material is:

- something Roman would realistically say;
- a complete, natural utterance rather than an isolated definition;
- current adult language for a speaker born in 1992: casual or neutral, without bookish wording, stale idioms, or forced Gen-Z slang;
- useful enough to recall and say aloud repeatedly;
- tagged by real-life topic and frequency.

Every generated candidate records a frequency band (`core`, `common`, `specific`, `rare`), currency (`current`, `contextual`, `dated`, `uncertain`), personal fit, naturalness, and commonness. Uncertain slang, idioms, and regional wording may be verified with a low-context web search before being proposed.

## Daily loop

The core production cycle is `Capture → Review → Library → Listen & Repeat → Recall → Learned`: capture real Russian thoughts, approve natural target-language cards, hear and shadow selected cards while walking, then retrieve the due cards from memory in writing. FSRS controls future due dates; a small client session queue controls only what returns during the current Recall session.

### Capture Reality

Tutor has a Notebook for thoughts Roman would genuinely want to express. A note can be typed directly in Russian or recorded freely and transcribed by OpenAI. Typed and transcribed notes enter the same ready queue, may be edited, and may accumulate across days.

`Prepare cards` takes the oldest ready notes within a 50,000-character window, removes repetition, separates ideas, and proposes up to 100 complete, natural utterances with one primary Topic. Active proposals are included by default. Roman can give package-level feedback such as “5 is too formal” or “7 means something else”; the model rebuilds the proposal package before anything is saved.

The source audio is temporary: it is deleted as soon as transcription succeeds. A failed transcription retains the audio only for Retry or Delete.

### Recall

Recall opens on the complete current FSRS due queue. The compact Topic and count controls are optional adjustments, not a required setup step: the selected Russian prompts are visible immediately below them, and Roman may start the default finite session without making a choice. Roman may narrow the queue to one Topic, choose 10, 20, 50, or all matching cards, or explicitly switch to Library practice. The active session presents one card at a time.

The card shows a natural Russian cue. Roman types the complete target-language version and presses Enter. Comparison is local and immediate. The same card shows his answer, the natural answer, and their differences; an FSRS grade then schedules it. A second Enter accepts the selected grade and advances.

Within the current session, `Again` returns the card after one other card and `Hard` returns it after several others. `Good` and `Easy` complete it for the session. These positions provide immediate reinforcement and do not replace the server's FSRS due date. A failed grade request keeps the answer, comparison, and selected grade available for retry.

Recall is the main memory metric, but Rehearsal has no universal daily quota or streak. The Practice heading shows quiet factual counts such as due now, recalled today, and listened today.

### Listen & Repeat

Listen & Repeat is the second and only other Practice mode. It also opens on the complete current FSRS due queue and shows the selected cards immediately. Roman may play that default queue without configuring it, narrow it by Topic or count, or explicitly switch to all Library cards. The player exposes Play/Pause, Previous, Replay, Next, Stop, and Russian reveal. The saved voice, natural-speed default, repetition count, and pause apply to the whole queue. Playback changes apply automatically to the next card request; the Russian cue is never spoken.

Listen & Repeat is currently available for English only. Latvian stays written-only in Practice and Library until a voice provider is good enough for it; the product does not silently substitute an unsuitable Latvian voice.

Every card is requested and played as a separate MP3 through one persistent browser audio element. Individual files are cached on the server, so the same text and voice settings do not spend provider credits twice. Global Voice and Playback settings are the single source of truth. Provider-specific limits are enforced before playback, including ElevenLabs `0.7–1.2×`. If the selected AI provider is unavailable, the complete queue may use browser speech instead. Listening activity never changes FSRS.

### Learned

`Learned` is an explicit, reversible user decision rather than an automatic FSRS state. Moving a card to Learned disables it for the daily due queue without deleting the card or its review history. Learned cards remain in Library and may be played or reviewed manually. Returning one to learning preserves its schedule and makes it eligible for the due queue again.

### Conversation

Tutor behaves like a normal ChatGPT conversation or role-play. It does not interrupt every sentence unless live correction was explicitly requested. At the end, `Finish & review` analyzes the complete exchange and proposes only meaningful corrections, reusable islands, and patterns.

## Approval boundary

LLM output never enters Library automatically. Tutor conversation review, pasted vocabulary, imported text, pattern drills, and Capture Reality all produce a review batch. Ordinary review candidates start unselected; Capture Reality selects active candidates by default so the notebook remains a batch workflow rather than a one-by-one import. Roman may edit, regenerate, change context, exclude, select, or revise a whole capture package. Only the final add action writes cards to Library, atomically.

Raw sources and rejected proposals may be retained for recovery and future analysis, but they are not practice material.

## Vocabulary workflow

For a list of up to roughly 100 words or phrases:

1. Paste or upload the list in Tutor.
2. The system deduplicates and triages entries as active, recognition-only, or skip.
3. Each useful active entry gets one strong personal anchor sentence with a complete Russian cue.
4. Results appear in pages of eight. Roman can request another version or a different context.
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

Available model IDs are checked periodically. A failed refresh keeps the last known working routing.

## Deferred on purpose

Pronunciation scoring, App Store distribution, fully native mobile rewrites, offline packs, and multi-user accounts are not required for the first usable single-student version. The intended phone delivery is an installable Home Screen PWA in standalone mode; interaction and layout rules live in `docs/MOBILE_APP_DIRECTION.md`.
