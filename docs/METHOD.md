# Rehearsal learning method

## Outcome

Rehearsal builds automatic spoken English and Latvian around one student's real life. Fluency is treated as a physical performance skill: useful language is prepared, heard, recalled, and spoken aloud until delivery no longer requires conscious grammar calculation.

## Content model

The visible unit is always a card. A card can hold a focus word in context, one sentence, a connected language island, or a short paragraph. These are different lengths of material, not separate product systems.

A Topic is an ordered collection of cards around one part of Roman's real life. “Language island” remains the learning-method term; the product calls the collection a Topic. One card may appear in more than one Topic. Recall and FSRS belong to the card, while Saturation follows the Topic order. Deleting a Topic never deletes its cards.

Good material is:

- something Roman would realistically say;
- a complete, natural utterance rather than an isolated definition;
- current adult language for a speaker born in 1992: casual or neutral, without bookish wording, stale idioms, or forced Gen-Z slang;
- useful enough to recall and say aloud repeatedly;
- tagged by real-life topic and frequency.

Every generated candidate records a frequency band (`core`, `common`, `specific`, `rare`), currency (`current`, `contextual`, `dated`, `uncertain`), personal fit, naturalness, and commonness. Uncertain slang, idioms, and regional wording may be verified with a low-context web search before being proposed.

## Daily loop

The core production cycle is `Capture → Topic → Saturation → Recall`: capture real Russian thoughts, approve natural target-language cards into a Topic, hear and shadow the ordered Topic while walking, then retrieve its cards from memory.

### Capture Reality

Tutor has a voice Notebook for thoughts Roman would genuinely want to express. He records freely in Russian, then corrects the OpenAI transcript instead of composing target-language examples one at a time. Notes may accumulate across days.

`Prepare cards` takes the oldest ready notes within a 50,000-character window, removes repetition, separates ideas, and proposes up to 100 complete, natural utterances with one primary Topic. Active proposals are included by default. Roman can give package-level feedback such as “5 is too formal” or “7 means something else”; the model rebuilds the proposal package before anything is saved.

The source audio is temporary: it is deleted as soon as transcription succeeds. A failed transcription retains the audio only for Retry or Delete.

### Recall

The card shows a natural Russian cue. Roman types the target-language version and presses Enter. Comparison is local and immediate. The same card shows the natural answer and differences; an FSRS grade then schedules it.

Recall is the main memory metric. The daily target is 100 completed recall attempts. Shadowing, audio plays, and pattern generation never inflate this number.

### Shadowing

The target-language card is played with a chosen voice, speed, repetition count, and pause. Roman repeats aloud and controls when to move on. Shadowing activity is counted separately and does not alter the FSRS recall schedule.

### Audio Saturation

Saturation turns one real-life topic into a single target-language MP3: phrase, pause, repeat, then the next phrase. Roman chooses the voice provider, voice, speed, pause, and one to five repetitions, waits for the complete track to load, presses Play, and shadows while walking. The Russian cue is never included.

The continuous track is deliberately separate from one-card Shadowing. It is designed for Brave on iPhone, background playback, lock-screen Play/Pause, and network-free continuation after the MP3 has loaded. Saturation never adds Recall attempts or changes FSRS.

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
6. The daily new-card limit (10 by default) prevents a large import from flooding Practice.

## Pattern drills

A Library card can generate a short substitution drill. Variants change one meaningful slot while retaining the useful structure or collocation. They are temporary proposals; only selected variants become cards.

## Scheduling

Recall uses `ts-fsrs` (FSRS-6) with short learning and relearning steps. Like, neutral, and dislike preferences modify retention targets and maximum intervals. The default caps are deliberately short for active speech: 60, 180, and 365 days rather than multi-year flashcard horizons. Scheduled reviews are never hidden by the daily new-card cap.

## Model routing

- Sol: natural Tutor conversation.
- Terra: conversation review, contextual generation, pattern drills, and other tasks requiring judgment.
- Luna: high-volume utility work and currentness checks.

Available model IDs are checked periodically. A failed refresh keeps the last known working routing.

## Deferred on purpose

Pronunciation scoring, App Store distribution, fully native mobile rewrites, offline packs, and multi-user accounts are not required for the first usable single-student version. The intended phone delivery is an installable Home Screen PWA in standalone mode; interaction and layout rules live in `docs/MOBILE_APP_DIRECTION.md`.
