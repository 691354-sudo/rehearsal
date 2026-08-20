# Theme refresh specification

## Goal

Replace the current overly bright light theme and overly dark night theme with the approved visual system:

- light theme: **Warm Stone**;
- dark theme: **Graphite Haze**;
- primary typeface: **Golos Text Variable**;
- primary accent: muted terracotta.

This document owns visual tokens and asset values. The unified interface work may
change layout, navigation, and interaction behavior under its own approved plan;
those changes must still use the exact colors and typography defined here.

## Before starting

Follow [AGENTS.md](../AGENTS.md):

1. Run `git status --short --branch` and `git log --oneline -5`.
2. Read `README.md`, `.interface-design/system.md`, and the styles relevant to this task.
3. Preserve unfinished work that belongs to another author.
4. Work on a separate `codex/<topic>` branch.

## 1. Replace Inter with Golos Text

Remove `@fontsource-variable/inter` and install `@fontsource-variable/golos-text`.

The selected package supports the variable weight axis, Cyrillic, Cyrillic Extended, Latin, and Latin Extended: [@fontsource-variable/golos-text](https://www.npmjs.com/package/%40fontsource-variable/golos-text?activeTab=readme).

Update:

- `package.json` and `package-lock.json`;
- `src/main.tsx`;
- `src/styles/base.css`;
- `src/styles/auth.css`;
- `.interface-design/system.md`.

Use this import:

```ts
import "@fontsource-variable/golos-text";
```

Use this font stack:

```css
font-family:
  "Golos Text Variable",
  "Golos Text",
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Keep the current type sizes and font weights. The variable font supports the intermediate weights already used in the stylesheets. Change an individual size or weight only when visual inspection confirms clipping, poor line height, or reduced readability.

Check English, Russian, and Latvian text.

## 2. Warm Stone light theme

Replace the main `.simple-app` tokens:

```css
--stage-canvas: #ece7df;
--script-surface: #f7f3ed;
--script-inset: #e6e0d7;

--script-ink: #282522;
--script-support: #6f6861;
--script-tertiary: #746d66;
--script-muted: #9d958d;

--script-rule: #d7cfc4;
--script-rule-strong: #bfb4a7;

--cue-light: #a4573b;
--cue-action: #a4573b;
--cue-wash: #ead8cd;
--cue-on: #fff9f4;

--control-fill: #e6e0d7;
--control-rule: #c9bfb3;
--control-focus: color-mix(
  in srgb,
  var(--cue-light) 18%,
  transparent
);
```

Set the normal `body` background to `#ece7df`.

The workspace should resemble warm paper. Do not use pure white for cards, fields, or navigation.

## 3. Graphite Haze dark theme

Replace the `.simple-app--dark` tokens:

```css
--stage-canvas: #2b2c2e;
--script-surface: #353638;
--script-inset: #252628;

--script-ink: #f1efec;
--script-support: #b8b5b0;
--script-tertiary: #a19e99;
--script-muted: #7d7b77;

--script-rule: #4c4d50;
--script-rule-strong: #606165;

--cue-light: #db906b;
--cue-action: #db906b;
--cue-wash: #4e352e;
--cue-on: #24140e;

--control-fill: #252628;
--control-rule: #55565a;
--control-focus: color-mix(
  in srgb,
  var(--cue-light) 20%,
  transparent
);
```

Set the system dark `body` background to `#2b2c2e`.

Keep the dark theme graphite-colored. Do not restore the `#090a0d` canvas, nearly black cards, or the cold violet accent.

Use the following text color on light action buttons in dark mode:

```css
.simple-app--dark .simple-workspace:not(.simple-workspace--library) {
  --mode-on: #24140e;
}
```

## 4. Unified workspace colors

Recall, Listen & Repeat, Chat, and Notebook use one visual system. They remain recognizable through their content and composition rather than separate action colors or tinted canvases.

All workspaces inherit the global canvas and terracotta action tokens:

```css
--mode-action: var(--cue-action);
--mode-canvas: var(--stage-canvas);
--mode-on: var(--cue-on);
```

Do not reintroduce green, blue, violet, or amber workspace palettes. Green, amber, and red remain reserved for semantic learning, note, warning, retry, and error states.

## 5. Status colors

Light theme:

```css
--learned: #3f7b60;
--learned-wash: #e2eee7;
--rehearsal-note: #97611f;
--retry: #a64f49;
```

Dark theme:

```css
--learned: #84c5a5;
--learned-wash: rgb(132 197 165 / 14%);
--rehearsal-note: #e0ad62;
--retry: #e28a82;
```

Green represents success and the Learned state. Amber represents notes and warnings. Red represents errors and retry actions.

## 6. Profile gate

Update `src/styles/auth.css`:

```css
--profile-canvas: #ece7df;
--profile-surface: #f7f3ed;
--profile-ink: #282522;
--profile-support: #6f6861;
--profile-rule: #d7cfc4;
--profile-action: #a4573b;
--profile-wash: #ead8cd;
```

Also:

- apply Golos Text;
- use `#fff9f4` for text on terracotta actions;
- replace the violet-tinted shadow with a neutral warm shadow;
- update placeholder and error colors to match the new system;
- preserve the current layout and authentication behavior.

Do not add a theme switcher to the profile gate.

## 7. PWA metadata and icons

Update the brand color in:

- `index.html`, `theme-color`: `#a4573b`;
- `vite.config.ts`, `theme_color`: `#a4573b`;
- `vite.config.ts`, `background_color`: `#ece7df`;
- `public/icons/app-icon.svg`;
- `public/icons/app-icon-maskable.svg`;
- raster PWA icons and `apple-touch.png`.

Use these icon colors:

- main background: `#a4573b`;
- letter and light details: `#fff9f4`.

Regenerate the PNG files from the updated SVG sources. Preserve the existing dimensions and maskable safe area.

## 8. Design-system documentation

Update `.interface-design/system.md`:

- replace `Inter Variable` with `Golos Text Variable`;
- name the light palette `Warm Stone`;
- name the dark palette `Graphite Haze`;
- replace the violet accent with muted terracotta;
- describe the active-sentence rail and focus border as terracotta;
- preserve the borders-only depth strategy;
- preserve the current sizes, radii, and spacing scale.

Remove outdated statements about a white working surface, midnight canvas, and violet accent.

## Theme scope limits

This theme specification alone does not authorize changes to:

- page components or structure;
- dimensions or spacing system;
- radii or depth strategy;
- navigation;
- Recall, Listen & Repeat, Tutor, Capture, or Library behavior;
- API, database, or server code;
- theme selection and persistence logic;
- animation behavior, apart from the colors used by existing transitions.

Do not add gradients, decorative shadows, new themes, or custom-color settings.

## Visual verification

Check both themes on:

- Profile Gate;
- Practice, including Recall and Listen & Repeat;
- Tutor, including Chat and Notebook;
- Library and Topics;
- Settings and dialogs;
- loading, empty, error, disabled, hover, and focus states;
- desktop;
- a narrow viewport near `390 × 844`.

Confirm that:

- Golos Text does not clip in buttons, inputs, dialogs, or bottom navigation;
- Russian and Latvian text render correctly;
- cards remain distinct from the canvas without harsh borders;
- inputs appear inset relative to their surrounding surface;
- essential text and interactive controls meet WCAG AA contrast;
- focus rings remain visible in both themes;
- theme switching does not produce a white or black flash;
- the chosen theme persists after reload;
- the standalone PWA uses the new background and icon.

If measured contrast requires a secondary color adjustment, make the smallest change and report the final value. Keep the approved canvas, surface, ink, and accent values unchanged.

## Automated checks

Run:

```bash
OPENAI_API_KEY= ELEVENLABS_API_KEY= npm test
npm run build
npm run check:architecture
git diff --check
```

For visual inspection, run:

```bash
npm run dev:codex
```

Open `http://127.0.0.1:4183/`, use `Continue as Roman`, and inspect desktop and mobile viewports.

## Completion criteria

The task is complete when:

- the application uses Golos Text Variable;
- the light theme matches Warm Stone;
- the dark theme matches Graphite Haze;
- the old Inter dependency and old active palette values `#f5f4f8`, `#090a0d`, and `#6956c9` no longer appear in the active theme, profile gate, or PWA metadata;
- PWA icons use the terracotta brand color;
- `.interface-design/system.md` matches the implementation;
- automated checks pass;
- visual verification finds no overflow, clipping, or unreadable state.

Deliver the change through a ready PR and squash merge after CI passes. Do not deploy to production without a separate request.
