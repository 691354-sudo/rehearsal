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
- Language and theme controls remain visible in the header.

## Practice pattern

- Practice is a single compact feed of island cards; there is no separate "Today" queue.
- The active island is the product signature: a slightly lifted surface, quiet violet border, and a thin violet rail on the left.
- A single direction toggle switches between RU to target-language recall and target-language shadowing.
- In recall, every card exposes a compact target-language input. Focusing an input activates its card without navigating away.
- Recall is a two-Enter loop: first Enter evaluates locally and shows an inline word diff; second Enter accepts the suggested memory grade, moves the card, and focuses the next phrase.
- `Again`, `Hard`, `Good`, and `Easy` belong only to recall because they grade memory. The suggested grade is the focused default.
- Each recall grade carries a quiet second-line interval preview. Reviewed cards leave the feed immediately and return only when FSRS marks them due.
- In shadowing, listening and repetition are one mode. Playback rhythm lives in settings, not in separate mode tabs.
- Shadowing has only playback, translation reveal, and a quiet next action; it does not ask for a memory grade.
- Drill is an inline action above the Cards feed, never a separate page or mode tab. It reads the visible queue from top to bottom with one persistent player and one cached MP3 per card.
- Topic selection is an optional multi-select filter. Manual card order and loop marks appear only when `Order` is active and persist per language on the device.
- A Drill first plays the complete visible queue once, then continues only the loop-marked cards until stopped.
- Inactive recall cards use a quiet `Show in EN/LV` action instead of explanatory hidden-answer copy.
- Topic and status metadata sit quietly at the lower-right edge of each card.
- Item utility is independent from memory: a compact footer selector sets Like, Neutral, or Dislike without adding a persistent control row.
- Daily volume appears beside the Practice title as a compact count and two-pixel progress rail, never as a dashboard card.
- Settings never dominate the practice screen.

## Global settings

- The header gear opens one right-side settings panel; it is available from every route.
- Voice, repetitions, speed, and pause are device preferences and update immediately.
- Voice options use the muted violet selected state; Marin and Cedar carry quiet recommended labels.
- FSRS retention, maximum interval, learning steps, relearning steps, and fuzz are saved explicitly to the database.
- Scheduler settings use compact table rows and familiar units rather than explanatory cards.
