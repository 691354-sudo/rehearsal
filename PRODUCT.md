# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Echo is a private language-learning tool for a small invited group. Learners use it in short daily sessions on desktop and as an installed phone PWA, often moving between capture, listening, written recall, and library maintenance.

## Product Purpose

Echo turns Russian notes and real personal material into reviewed target-language sentence cards. English and Latvian are standard; Vietnamese may be enabled per profile. Success means moving through Capture → Review → Library → Listen & Repeat → Recall → Learned with little interface friction while preserving deliberate approval and FSRS scheduling.

## Positioning

The product rehearses the users' own language and situations rather than a generic course. It combines personal capture, spoken saturation, written recall, topic-based language islands, and explicit review before generated material enters the Library.

## Operating Context

- Desktop supports efficient keyboard-driven review and library management.
- Narrow-phone use must remain complete through visible touch controls.
- Listen & Repeat may continue during walking or background listening.
- English and profile-enabled Vietnamese support speech playback; Latvian uses Recall without application TTS.
- GitHub is the source of truth and production receives CI-checked commits only.

## Capabilities and Constraints

- Every PIN profile has isolated data, settings, Tutor history, schedules, audio cache, and backups; new profiles require a one-time invitation.
- FSRS owns future due dates; the focused queue may repeat Again and Hard cards within the current session.
- Tutor and ingestion produce drafts that require explicit user approval before Library mutation.
- One audio element and cached responses support playback; browser speech is the fallback.
- The installed PWA must not require a keyboard, hover, or right-click for core flows.
- Record and Compare is deferred and is not part of the current product.

## Brand Commitments

- Product name: Echo.
- Voice: direct, calm, compact, and specific.
- The approved interface uses Warm Stone and Graphite Haze, Golos Text Variable, and one muted terracotta action color across workspaces.

## Evidence on Hand

- Canonical methodology: `docs/METHOD.md`.
- Architecture and product boundaries: `docs/ARCHITECTURE.md`.
- Mobile and PWA direction: `docs/MOBILE_APP_DIRECTION.md`.
- Approved theme values: `docs/THEME_REFRESH_SPEC.md`.
- The repository contains the working Practice, Tutor, Notebook, Library, Settings, profile gate, and PWA implementation.

## Product Principles

- Personal reality before generic exercises.
- One primary action and progressive disclosure over competing surfaces.
- Spoken saturation and written recall are distinct methods inside one coherent product.
- Every generated or imported learning item remains reviewable before persistence.
- Phone flows stay touch-complete without sacrificing the desktop keyboard path.

## Accessibility & Inclusion

Core flows must work with keyboard and visible focus on desktop, with 44 px touch targets on phone, reduced motion, semantic controls, stable language metadata, and announcements for asynchronous state.
