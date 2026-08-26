# Rehearsal mobile app direction

## Target

The intended phone experience is an installable iPhone Home Screen web app. It
should launch from its own icon in standalone mode without Safari chrome and feel
complete when used only by touch. App Store distribution and a native iOS rewrite
are not current goals.

The delivery path is the Progressive Web App served by the existing HTTPS
deployment. The application shell and API share one origin and deployment base
path. Do not add native wrappers or abstractions without a separately approved
native-only requirement.

The same responsive client also runs as a native Telegram iPhone Mini App. Telegram is a container and authenticated entry point, not a fork of the interface: it opens the existing mobile Tutor, Notebook, Library, Practice, and review routes against the same API and profile data.

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
- Keep application and API requests on the same origin and current deployment
  base path. Authentication cookies and CSRF protection depend on that boundary.
- Treat the server database as the source of truth. Browser storage may hold UI
  preferences and one pending recording per profile and language, but correctness
  must not depend on storage being shared with Safari or surviving an iOS eviction.
- Network loss must be visible and recoverable. Never silently discard a typed
  answer, Tutor draft, recording, edit, or review action after a failed request.
- Keep generated assets and routes compatible with a non-root deployment under
  `/rehearsal/`; manifest, icons, service worker scope, and start URL must work
  from that base path.
- Direct Practice, Tutor, and Library links must load the application shell. A
  missing hashed asset must fail as an asset and trigger the one-shot app-shell
  recovery path instead of receiving `index.html` with a successful status. The
  `/recover` navigation stays network-only, restores the original client URL,
  and shows manual recovery actions if the fresh application still cannot mount.
- Treat useful UI state as navigation state. Practice mode and selection, Tutor
  mode/thread, Library filters/page, Topics, Settings, Import, and Card Editor
  use stable routes or query parameters so reload and Back/Forward recover the
  same surface. Never put answers, recordings, playback position, or sensitive
  data in the URL.
- Never service-worker-cache API responses, private learning data, or generated
  audio. Only the versioned application shell and static build assets are precached.

## Current installable PWA

The current build includes:

- a web app manifest with a stable ID, scoped start URL, `display: standalone`,
  theme/background colors, and suitable iPhone icons;
- iOS Home Screen metadata; no permanent installation tutorial is required for
  the two known users;
- a service worker for a versioned application shell and an understandable
  offline/unavailable state, without pretending server-backed features are local;
- standalone-specific safe-area and navigation behavior;
- a controlled update flow that does not leave old UI talking to an incompatible
  API after a deployment.

Capture writes a completed recording Blob to IndexedDB before upload. The PWA
restores it after relaunch and offers Retry or Delete; it removes the local copy
only after the server confirms success. This is recovery for one pending recording,
not a general offline queue or offline learning store.

## Product layout

- Practice contains only `Recall` and `Listen & Repeat`. On mobile, both present
  one active card at a time and keep session controls reachable by touch; the
  desktop Recall list may expose written-answer fields without changing this path.
- Recall defaults to `Recommended now`; custom Library practice remains an explicit
  secondary choice.
- Notebook gives typed Russian capture and voice capture equal prominence.
- Tutor Chat exposes a touch-sized voice-message action and keeps failed transcription audio available for Retry or Delete while the page remains open.
- Library shows cards before management tools. Topic management and transcript
  import use secondary dialogs or panels.
- Mobile keeps the three-item bottom navigation. The top bar shows the current
  section and one compact menu rather than every profile, language, theme, and
  settings control at once.
- The canonical routes are `/practice/recall`, `/practice/listen`,
  `/tutor/chat`, `/tutor/notebook`, `/library`, and `/library/topics`. Links must
  preserve the selected `lang` and honor the deployment base path.
- Settings, card creation, and editors are modal, contain their own overscroll, restore focus,
  and protect unfinished input. Tutor and Notebook drafts are restored from
  profile-scoped session storage after reload or Back.

## Telegram Mini App

- Load the official Telegram Web App bridge from `https://telegram.org`; call `ready()` and `expand()` after bootstrap.
- Exchange validated `initData` for the ordinary profile cookie. An unconnected Telegram user sees the existing profile choice and enters that profile's PIN once.
- Combine Telegram viewport, safe-area, and content-safe-area values with iOS CSS environment insets. Core controls remain at least 44 px and must not depend on hover.
- Show Telegram's native BackButton only after the in-app route stack has a previous Echo entry. Initial deep links stay stable.
- A Telegram `deactivated` event pauses an actively playing Listen & Repeat queue without discarding it. `activated` never resumes automatically; the learner explicitly taps Resume.
- Native Telegram on iPhone is the v1 verification target. Telegram Desktop/Web iframe behavior and locked-screen playback are out of scope.

## Verification gate

Changes to a core flow are not phone-ready until they have been checked at common
narrow portrait widths and on a real iPhone in both Safari and Home Screen
standalone mode. Verify touch navigation, the software keyboard, scrolling,
dialogs, audio, text-file import, network loss/recovery, and relaunch after an
updated deployment. Desktop keyboard regression checks still apply.

## Explicit non-goals for now

- App Store submission, StoreKit, billing, or public multi-user distribution.
- SwiftUI or React Native rewrites.
- Native wrapper packaging before a concrete native-only requirement appears.
- Telegram Web iframe support or locked-screen Telegram playback.
- Full offline learning packs or background synchronization unless separately
  scoped and designed.
