---
name: Rehearsal
description: "A calm, sentence-led practice workspace in Warm Stone and Graphite Haze."
colors:
  warm-stone-canvas: "#ece7df"
  warm-stone-surface: "#f7f3ed"
  warm-stone-inset: "#e6e0d7"
  warm-stone-ink: "#282522"
  warm-stone-support: "#6f6861"
  warm-stone-rule: "#d7cfc4"
  graphite-canvas: "#2b2c2e"
  graphite-surface: "#353638"
  graphite-inset: "#252628"
  graphite-ink: "#f1efec"
  graphite-support: "#b8b5b0"
  graphite-rule: "#4c4d50"
  terracotta-light: "#a4573b"
  terracotta-dark: "#db906b"
  accent-on-light: "#fff9f4"
  accent-on-dark: "#24140e"
  learned-light: "#3f7b60"
  learned-dark: "#84c5a5"
  note-light: "#97611f"
  note-dark: "#e0ad62"
  retry-light: "#a64f49"
  retry-dark: "#e28a82"
typography:
  page-title:
    fontFamily: '"Golos Text Variable", "Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 680
    letterSpacing: "-0.035em"
  sentence-cue:
    fontFamily: '"Golos Text Variable", "Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
  body:
    fontFamily: '"Golos Text Variable", "Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Golos Text Variable", "Golos Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 600
rounded:
  compact: "7px"
  control: "8px"
  overlay: "10px"
  surface: "12px"
spacing:
  micro: "4px"
  compact: "8px"
  control: "12px"
  section: "16px"
  panel: "24px"
  region: "32px"
---

# Design System: Rehearsal

## Overview

**Creative North Star — The Rehearsal Desk.** Rehearsal should feel like one quiet, well-arranged working surface: the sentence is the material, controls are tools placed around it, and the interface never competes for attention.

**The Sentence Leads Rule.** In Practice, Library, Topics, Chat, and Notebook, the user's sentence or thought receives the strongest type and the clearest position. Metadata, translation, scheduling, and controls remain visibly secondary.

The built system has four durable characteristics:

- One visual language across routes: Warm Stone in light mode and Graphite Haze in dark mode.
- One muted terracotta accent for current location, selection, primary action, and focus.
- Compact desktop workspaces with visible keyboard efficiency, paired with touch-complete mobile layouts.
- Progressive disclosure: one primary action stays obvious; advanced settings and destructive or batch actions appear only when requested.

## Colors

Warm Stone uses `warm-stone-canvas`, `warm-stone-surface`, and `warm-stone-inset` for its three depth levels. Graphite Haze uses the corresponding graphite tokens. Text and rules always use the matching theme family; avoid pure white and pure black.

**The One Accent Rule.** `terracotta-light` and `terracotta-dark` are theme-matched forms of the same accent. Use them for active navigation, segmented selections, primary buttons, the Recall focus rail, focus rings, and interactive progress. Do not assign colors to individual modes or routes. The installed PWA uses the light terracotta value for browser chrome and icon detail as an intentional brand exception to the neutral canvas.

Green is reserved for learned/success, amber for notes or warnings, and red for retry, failure, or destructive actions. Status colors communicate meaning and never become decorative route themes.

## Typography

Golos Text Variable is the product typeface for interface and learning content. The system stack in the tokens is the only fallback chain.

- Page titles: 24–25px, weight 680, tight tracking.
- Russian recall cues: 24–31px, weight 600; this is the strongest practice text.
- Section and card titles: 16–19px, weight 590–650.
- Body and controls: 15–16px at 1.5 line height. Form controls stay 16px on narrow screens to prevent mobile zoom.
- Labels and metadata: 12–14px, weight 550–650, using sentence case rather than uppercase microcopy.

Use balanced wrapping for headings and natural wrapping for prose. Learning sentences may break long words when required, but controls and metadata should remain compact. Do not reduce functional text below 12px.

## Layout

The shared desktop shell is a centered 1080px rail with 24px side gutters. The 4px base grid produces the recurring 8, 12, 16, 24, and 32px spacing steps. Main working panels use 24px internal padding on desktop and 16px on narrow screens.

Practice and Library use ordinary document framing until work begins. Tutor Chat, Tutor Notebook, and the Library results surface use the remaining viewport height; only their message, notebook, or result region scrolls. This keeps navigation, mode controls, and composers stable.

At 900px the shell tightens. At 720px Tutor and Topics recompose for one column, Settings becomes a full-width drawer, and horizontal topic navigation is allowed. At 560px the fixed bottom navigation becomes the primary route switcher, controls stack, gutters reduce to 16px plus safe-area insets, and active Recall hides page/setup chrome to protect the card workspace. Dynamic viewport units keep full-height surfaces clear of mobile browser chrome.

**Stable URL surfaces.** The visible routes are `/practice/recall`, `/practice/listen`, `/tutor/chat`, `/tutor/notebook`, `/library`, and `/library/topics`. Route-specific filters and state remain addressable through query parameters: language; practice scope, topic, count, and review; Tutor thread; and Library search, status, topic, sort, page, import, and editor. Navigation is `BASE_URL`-safe. Browser Back closes Settings, Import, and Card Editor before leaving the underlying surface; guarded editors do not discard unsaved work silently.

## Elevation & Depth

Depth is created with neutral tonal steps and 1px rules, not gradients or decorative shadows. Canvas contains surfaces; surfaces contain inset controls and scroll regions. Stronger rules identify active working boundaries, including the thin terracotta top or side rail used by Tutor and Recall.

Shadows are limited to transient overlays that need separation from moving content, such as action menus or update prompts. They are not a card treatment and do not form an elevation scale.

## Shapes

Controls use an 8px radius, working surfaces use 12px, and transient menus use 10px. The compact 7px radius is reserved for small identity marks and dense utility details. Pills are appropriate only for compact counts or status; navigation, tabs, fields, and primary actions remain rounded rectangles.

All pointer controls have a minimum 44×44px hit area. Icon-only controls include a visible focus state and an accessible name.

## Components

### App shell and navigation

Desktop uses the top header; mobile uses a concise contextual header plus fixed bottom navigation. The current route is shown with terracotta wash and text, not a separate colored mode. Links remain real links so open-in-new-tab, reload, and Back behavior work normally.

### Buttons, fields, and selection

Primary buttons use solid terracotta with the matching on-accent text. Secondary buttons and fields use neutral inset fills and rules. Selected segmented controls combine an accent rule/wash with `aria-pressed`; focus uses a 2px accent outline with a 2px offset. Disabled actions keep their shape and label while visibly receding. Placeholders are quieter than entered text and never replace labels where the choice needs context.

### Practice and Recall

Practice starts with one compact setup panel followed by a sentence-led queue. Listen & Repeat leads with playback configuration and one full-width Play action. Recall setup exposes source, Topic, and Cards, then starts **Focus mode**.

Active Recall is one card at a time: Russian cue, target-language answer, comparison, natural answer, and four memory grades. On desktop the answer retains focus: Enter checks, Left/Right changes the selected grade, and Enter confirms and advances. Every keyboard action has a visible button equivalent. On mobile the surrounding Practice heading, mode switch, and setup are removed during the session while End, progress, answer, grades, and voice settings remain available.

Exact and compare results are announced through a polite live region. Language content carries the correct `lang` metadata. Session completion returns a clear next action without exposing implementation detail.

### Tutor Chat and Notebook

Chat and Notebook share the same full-height bordered workspace and thin terracotta focus line. Chat has a session rail on desktop, an empty-state prompt set, a growing message region, and a composer pinned to the bottom. Notebook leads with Russian thought capture, then a sentence-led list and a distinct Prepare cards action. On mobile their toolbars reflow without shrinking targets; text entry and send/record/upload actions remain touch complete.

### Library

Search, status, topic, and sort controls form one filter surface above the results. Phrase, translation, and topic lead each card; Play, Learned, and Edit remain visible, while Review, Pattern, and Delete live under More. The URL-backed result page discloses 20 cards at a time, and rows use content visibility for long-list rendering. Select mode adds checkboxes only while bulk work is active; on narrow screens the checkbox overlays the card corner so sentence width is preserved.

### Topics: Add and Select

Topics uses a topic rail and a sentence-led membership list. The selected topic owns the Add cards, Rename, Select, and Delete actions; each membership row keeps one right-aligned Edit control. **Add cards** opens a searchable picker and reveals eligible cards in increments of 20; selection is explicit before confirmation. **Select** changes the membership list into batch mode, reveals checkboxes, and exposes Move and Remove actions. Outside batch mode, checkbox and batch chrome are absent. On narrow screens, the topic rail becomes horizontally scrollable and the membership list remains a single readable column.

### Settings, dialogs, and states

Settings is a native modal dialog: a right drawer on desktop and a full-width surface on mobile. Its header and close control stay available while the body scrolls independently and background scrolling is contained. Playback changes apply immediately; scheduling changes retain their explicit save behavior. Import and Card Editor follow the same contained-scroll and Back/Escape expectations, with unsaved-change guards.

Empty states name the next useful action. Errors use `role="alert"`; async changes and Recall feedback use live regions. Skip navigation, semantic controls, visible focus, reduced-motion fallbacks, and safe-area spacing are part of the component contract.

## Do’s and Don’ts

- **Do** let the learning sentence dominate every working surface.
- **Do** use the single terracotta accent consistently and reserve semantic colors for status.
- **Do** preserve 44px targets, visible keyboard focus, touch equivalents, correct language metadata, and reduced-motion behavior.
- **Do** keep filters, open editors, and practice context reflected in stable URLs where the implementation supports them.
- **Do** reveal Add, Select, More, and advanced settings only when they become relevant.
- **Don’t** reintroduce mode-specific palettes, gradients, decorative shadows, pure-white cards, or pure-black canvases.
- **Don’t** crowd sentence rows with permanent secondary or destructive actions.
- **Don’t** rely on hover, right-click, or a physical keyboard for a core phone flow.
- **Don’t** use uppercase microcopy, tiny functional text, or pill shapes as a default style.
