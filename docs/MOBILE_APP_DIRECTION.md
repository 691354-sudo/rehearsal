# Rehearsal mobile app direction

## Target

The intended phone experience is an installable iPhone Home Screen web app. It
should launch from its own icon in standalone mode without Safari chrome and feel
complete when used only by touch. App Store distribution and a native iOS rewrite
are not current goals.

The first delivery path is a Progressive Web App served by the existing HTTPS
deployment. Keep the React client compatible with a future Capacitor shell, but
do not add native abstractions or plugins until a required capability cannot be
delivered reliably as a Home Screen web app.

## Rules for future changes

- Keep every core flow fully usable by touch. Desktop keyboard shortcuts remain
  valuable, but they must never be the only way to practice, grade, navigate,
  save, close, or recover from an error.
- Design for narrow iPhone portrait widths first, then enhance wider layouts.
  Do not rely on hover, right-click, or permanently visible side panels.
- Keep primary touch targets approximately 44 by 44 CSS pixels or larger and
  leave enough separation to prevent accidental taps.
- Respect `env(safe-area-inset-*)`, the on-screen keyboard, Dynamic Island/home
  indicator areas, text zoom, and `100dvh`-style viewport changes. Fixed headers,
  composers, dialogs, and bottom navigation must remain reachable while typing.
- Use feature detection for browser capabilities. Audio playback, recording,
  file import, notifications, and clipboard access need explicit user actions,
  denied-permission states, and a useful fallback where practical.
- Do not hardwire the client to a same-origin API. Keep the API base configurable
  so the same build can run on the website, as an installed PWA, or later inside
  a Capacitor shell without changing feature code.
- Treat the server database as the source of truth. Browser storage may hold UI
  preferences and a bounded pending-action queue, but correctness must not depend
  on storage being shared with Safari or surviving an iOS eviction.
- Network loss must be visible and recoverable. Never silently discard a typed
  answer, Tutor draft, recording, edit, or review action after a failed request.
- Keep generated assets and routes compatible with a non-root deployment under
  `/rehearsal/`; manifest, icons, service worker scope, and start URL must work
  from that base path.
- Avoid indiscriminate service-worker caching of API responses, private learning
  data, or generated audio. Version the app shell and define an explicit update
  and cache-retention policy before offline caching is added.

## Installable PWA milestone

When this milestone is implemented, it should include:

- a web app manifest with a stable ID, scoped start URL, `display: standalone`,
  theme/background colors, and suitable iPhone icons;
- iOS Home Screen metadata; no permanent installation tutorial is required for
  the two known users;
- a service worker for a versioned application shell and an understandable
  offline/unavailable state, without pretending server-backed features are local;
- standalone-specific safe-area and navigation behavior;
- a controlled update flow that does not leave old UI talking to an incompatible
  API after a deployment.

## Product layout

- Practice contains only `Recall` and `Listen & Repeat`. On mobile, both present
  one active card at a time and keep session controls reachable by touch; the
  desktop Recall list may expose written-answer fields without changing this path.
- Recall defaults to `Due today`; custom Library practice remains an explicit
  secondary choice.
- Notebook gives typed Russian capture and voice capture equal prominence.
- Library shows cards before management tools. Topic management and transcript
  import use secondary dialogs or panels.
- Mobile keeps the three-item bottom navigation. The top bar shows the current
  section and one compact menu rather than every profile, language, theme, and
  settings control at once.

## Verification gate

Changes to a core flow are not phone-ready until they have been checked at common
narrow portrait widths and on a real iPhone in both Safari and Home Screen
standalone mode. Verify touch navigation, the software keyboard, scrolling,
dialogs, audio, text-file import, network loss/recovery, and relaunch after an
updated deployment. Desktop keyboard regression checks still apply.

## Explicit non-goals for now

- App Store submission, StoreKit, billing, or public multi-user distribution.
- SwiftUI or React Native rewrites.
- Capacitor packaging before a concrete native-only requirement appears.
- Full offline learning packs or background synchronization unless separately
  scoped and designed.
