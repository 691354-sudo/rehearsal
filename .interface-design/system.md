# Rehearsal interface system

## Direction

Rehearsal is a pragmatic, practice-first personal language tool. It should feel calm, immediately understandable, and comfortable for daily 10–30 minute sessions. Design quality comes from hierarchy, spacing, typography, and interaction clarity rather than decoration or metaphor.

## Typography

- Inter Variable throughout the product.
- No serif typefaces.
- Interface body text: 15–16 px.
- Inputs and learning text: 18 px minimum.
- Russian cue: 24–31 px depending on viewport.
- Avoid uppercase microcopy and text below 12 px.

## Color

- Light and dark themes share identical hierarchy and layout.
- One muted violet accent for actions, selection, and the active rehearsal state.
- Green and amber are reserved for learning outcomes and status.
- Light: soft neutral canvas, white working surface, graphite text.
- Dark: midnight canvas, graphite working surface, cool off-white text.
- Theme choice persists; first visit follows system preference.

## Depth

- Borders-only depth strategy.
- Two primary surfaces: canvas and working surface; inputs use an inset surface.
- No decorative gradients or dramatic shadows.
- Border contrast stays quiet but visible in both themes.

## Spacing and shape

- Base unit: 4 px, with an 8 px layout rhythm.
- Common spacing: 4, 8, 12, 16, 24, 32 px.
- Controls: 8 px radius.
- Primary working surface: 12 px radius.
- Avoid excessive nested cards.
- Desktop practice controls stay compact; mobile touch targets can expand later without changing the visual hierarchy.

## Navigation

- Compact top navigation on desktop.
- Three-item bottom navigation on mobile: Practice, Tutor, Library.
- Desktop keeps language, profile, theme, and settings visible when they fit.
- Mobile keeps the current section visible and moves language, profile, theme, and settings into one compact menu.

## Practice pattern

- Practice has two modes only: written `Recall` and `Listen & Repeat`.
- One active sentence is the product signature: a focused working surface with a quiet violet border and thin violet rail, surrounded by only the controls needed for the current action.
- Both modes default to the complete ordered FSRS `Due now` selection. Topic, count, and custom Library practice are compact optional controls; the resulting cards appear immediately below them before a session starts.
- Recall queue previews show Russian prompts without revealing the target-language answer. On desktop each row also has its own answer field, while mobile reserves answer input for the focused one-card session. Long previews reveal ten cards at a time through `Load more`.
- Every visible Practice queue card keeps compact Play, Edit, and category metadata actions. For English Recall, checking plays the natural answer by default and the result keeps a manual Play action; Settings may disable only the automatic playback.
- Recall is a two-Enter loop: first Enter evaluates the written target-language answer and shows an inline word diff; second Enter accepts the selected memory grade and advances.
- `Again`, `Hard`, `Good`, and `Easy` belong only to recall because they grade memory. The suggested grade is the focused default.
- Each recall grade carries a quiet second-line interval preview. Reviewed cards leave the `Due now` scope until FSRS marks them due again, but remain available under `All Library cards`.
- `Again` and `Hard` return within the current session; `Good` and `Easy` complete the card for that session. FSRS independently owns the future due date.
- Listen & Repeat is one continuous target-language player with Play/Pause, Previous, Replay, Next, Stop, and Russian reveal. It never asks for a memory grade.
- The player uses one persistent audio element and one cached MP3 per card, with browser speech as a whole-session fallback.
- Topic selection uses Library Topics, never the first item tag.
- Daily volume appears beside the Practice title as quiet factual counts, never as a quota, streak, or dashboard card.
- Settings never dominate the practice screen.

## Capture and Library

- Notebook presents one Russian text field and one Record action in the same working surface. Empty states are terse because both users already understand the method.
- Library begins with Search, learning status, Topic, and sort controls followed immediately by cards.
- Topic management and text import are secondary dialogs or panels.
- `Learned` is an explicit reversible item state. It never looks like deletion and it preserves the FSRS history.
- Pattern Drill is a labeled card action whose proposals remain dismissible drafts until selected.
- Library card text leads at 17 px target / 14 px cue on desktop; secondary actions use 11–12 px labels in compact 34–36 px controls. Editing uses the shared elevated card dialog rather than expanding into the list row.
- Topic management uses a 220 px selection rail and a sentence-led detail pane. Each membership row exposes `Move to…` and explicit Remove; manual ordering is absent because it has no learning meaning. While this panel is open, the ordinary Library list is hidden.
- Notebook Review places one optional comment field under every proposal. Empty means approve; a comment requests a replacement for that card only. One action saves approved proposals and returns revised proposals without a package-level feedback box.
- Tutor Chat / Notebook is a high-visibility 14 px segmented control. Loaded history jumps to the latest position without animated traversal; only genuinely new content scrolls smoothly.

## Global settings

- The header gear opens one right-side settings panel; it is available from every route.
- Voice, repetitions, speed, and pause are one shared device preference: Global Settings and Cards edit the same values immediately. Settings shows one quiet confirmation that changes apply to the next card; it never places playback changes behind a global Save button.
- Voice options use the muted violet selected state; Marin and Cedar carry quiet recommended labels.
- Provider voice identity and Preview remain visible. ElevenLabs verification details, model choice, tuning sliders, speaker boost, cache information, and the external voice link live under `Advanced voice`.
- FSRS retention, maximum interval, learning steps, relearning steps, and fuzz are saved explicitly to the database.
- `New cards per day` remains a normal setting. Retention, intervals, learning steps, relearning steps, and fuzz live under Advanced scheduling.
