# Rehearsal interface system

## Direction

Rehearsal is a calm, practice-first personal language tool. The learner's sentence is the dominant visual material; controls support it and recede. Recall, Listen & Repeat, Chat, and Notebook differ through composition and content, not separate color themes.

## Typography

- Golos Text Variable throughout the application, profile gate, controls, and learning content.
- Font stack: `"Golos Text Variable", "Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Interface body text: 15–16 px. All mobile form controls are at least 16 px.
- Russian cue: 24–31 px depending on viewport.
- Avoid uppercase microcopy and text below 12 px. English, Russian, and Latvian text must wrap without clipping.

## Color

- Light theme: **Warm Stone** — canvas `#ece7df`, surface `#f7f3ed`, inset `#e6e0d7`, ink `#282522`.
- Dark theme: **Graphite Haze** — canvas `#2b2c2e`, surface `#353638`, inset `#252628`, ink `#f1efec`.
- One muted terracotta accent: `#a4573b` in light mode and `#db906b` in dark mode. It identifies the current route, selected state, primary action, and focus.
- Green, amber, and red are reserved for success/Learned, notes or warnings, and error/retry states.
- Large workspace backgrounds remain neutral. The selected terracotta PWA `theme-color` is an intentional brand exception to canvas-colored browser chrome.

Exact tokens live in `docs/THEME_REFRESH_SPEC.md` and must not be independently redefined here.

## Depth, spacing, and shape

- Borders-first depth strategy; no gradients or decorative shadows.
- Two primary surfaces: canvas and working surface; inputs use an inset surface.
- Base unit: 4 px, with an 8 px layout rhythm. Common spacing: 4, 8, 12, 16, 24, 32 px.
- Controls use an 8 px radius; primary working surfaces use 12 px.
- One shared focus ring and one border/radius/shadow language.
- All interactive targets are at least 44×44 CSS px; compact icons sit inside that hitbox.

## Shared shell and responsive grid

- Header and all desktop workspaces share a centered rail up to 1080 px wide with 24 px side gutters.
- Narrow screens use 16 px workspace gutters and safe-area insets.
- Tutor Chat fills the dynamic viewport beneath the header; only message history scrolls and the composer remains visible.
- Notebook fills the available viewport and grows with content.
- Ordinary Library fills the available viewport and makes the card list its primary scroller. Import, review, and Topics use document flow.
- Mobile active Recall hides setup chrome and keeps one current card plus its action.
- Settings and editors use native modal dialogs, contain internal overscroll, and block background scrolling.

## Navigation and URL contract

- Desktop uses compact top navigation; mobile uses the three-item Practice, Tutor, Library bottom navigation.
- Primary navigation and mode switches are real links.
- Stable routes: `/practice/recall`, `/practice/listen`, `/tutor/chat`, `/tutor/notebook`, `/library`, and `/library/topics`.
- Stable state is encoded in query parameters: language, Practice scope/topic/count/review card, Tutor thread, Library search/status/topic/sort/page/import/editor, and open Settings.
- Links and parsing honor `import.meta.env.BASE_URL`, including production under `/rehearsal/`.
- Back closes Settings, Import, and Card Editor. Unsaved Import and Card Editor content is guarded. Tutor and Notebook drafts are restored from profile-scoped session storage.

## Practice pattern

- One active sentence is the product signature: a focused neutral working surface with a terracotta focus border and thin terracotta Recall rail.
- Recall and Listen & Repeat share selection controls and palette. Recall grades memory; Listen & Repeat provides continuous playback without grades.
- Queue preview and setup share the same width and panel padding. Empty Due now offers one action to browse Library.
- Desktop keeps the two-Enter Recall path and inline queue answers. Mobile keeps the equivalent visible touch path.
- Progress uses compositor-friendly transforms and all motion respects `prefers-reduced-motion`.

## Tutor, Notebook, and Library

- Chat is distinguished by message bubbles and a fixed composer. Empty Chat offers up to three starter prompts and Tutor updates use a polite live log.
- Notebook is distinguished by capture and review structure. Typed and voice capture are both visible; its empty state has one short method-specific prompt.
- Library card language leads. Play, Learned/Reactivate, and Edit remain visible; Review now, Pattern drill, and Delete live in a controlled More disclosure. Topic metadata sits at the quiet edge of the action row instead of competing with the phrase.
- Library renders 20 cards per URL page and applies `content-visibility` to rows. A single `Select` control enters bulk-selection mode; only then do card checkboxes and bulk actions appear. On narrow screens, each 44 px selection target overlays its card corner instead of reserving a permanent grid column.
- Practice queue numbers are quiet inline indices rather than a dedicated column. Topic labels sit beneath the Play/Edit controls, keeping phrase width available for learning content.
- Topics keeps membership rows sentence-led. `Select` reveals card checkboxes and one batch toolbar for Move/Remove; those controls never occupy every row. `Add cards` opens a compact labeled search picker near the Topic heading, with left-aligned results and 20-result increments.

## Global settings and accessibility

- The header gear opens one native modal dialog styled as a right drawer.
- Playback preferences apply immediately; FSRS scheduling changes save explicitly.
- Every control has an accessible name. Asynchronous results use status, alert, or polite live regions.
- The document language is English; Russian cues and target-language text carry explicit language metadata.
- The application provides a skip link, stable main landmark, visible `:focus-visible`, reduced-motion behavior, and touch-safe tap handling.
