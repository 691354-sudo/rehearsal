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
- Mobile normally keeps the three-item bottom navigation. In Tutor/Notebook, a
  software keyboard moves section access to the labelled Tutor dropdown in the
  top bar; closing the keyboard restores the bottom bar. Focus alone or pinch
  zoom must not hide navigation. Drafts survive section and chat changes.
- Tutor has a compact Chat/Notebook switch, a Sessions entry, and an app menu.
  Review cards stays beside the input in Chat and Notebook. Mobile Return inserts
  a newline; sending uses the visible arrow. Desktop Enter sends, Shift+Enter
  inserts a newline, and IME composition never submits. The mobile composer grows
  from several readable lines to a bounded height, then scrolls internally.
- Review adjustments open as a separate mobile editor with Back/Done returning to
  the same proposals. Neither action adds a card to Library. Topic and AI
  alternatives have an explicit disclosure indicator.
- Manage Topics opens a searchable topic list, then the selected topic’s cards. Creating,
  renaming, moving cards, choosing a merge destination, and confirming the merge are
  separate steps. Mobile lists scroll between the heading and the visible action footer;
  retain the current selection when a write fails. Topic deletion states the card and
  review-history consequences before confirmation. A partial merge must report the
  completed transfer separately from source deletion.
- The canonical routes are `/practice/recall`, `/practice/listen`,
  `/tutor/chat`, `/tutor/notebook`, `/library`, and `/library/topics`. Links must
  preserve the selected `lang` and honor the deployment base path.
- Settings, card creation, and editors are modal, contain their own overscroll, restore focus,
  and protect unfinished input. Tutor and Notebook drafts are restored from
  profile-scoped session storage after reload or Back.

## Telegram Mini App

- Load the official Telegram Web App bridge from `https://telegram.org`; call `ready()` and `expand()` after bootstrap.
- Exchange validated `initData` for the ordinary profile cookie. An unconnected Telegram user sees the existing profile choice and enters that profile's PIN once.
- Combine Telegram viewport, safe-area, and content-safe-area values with iOS CSS environment insets. Use the visible viewport for keyboard layout; never hard-code the height of Telegram chrome or an iOS keyboard. Apply the touch-target rule above to effective hit areas, not icon artwork.
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
