# Rehearsal project instructions

This file is the canonical starting point for every new coding chat or developer session.

## Start here

Before changing files:

1. Run `git status --short --branch` and `git log --oneline -5`.
2. Read `README.md`, then only the canonical document and modules relevant to the task. Do not reread every project document for a small change.
3. Fetch `origin` before creating or merging a branch. Never overwrite an existing dirty worktree.
4. For UI or mobile work, also read the relevant parts of `docs/MOBILE_APP_DIRECTION.md`.
5. State a plan only for multi-step, ambiguous, destructive, data, auth, or deployment work. Start trivial work immediately.

## Sources of truth

- Product behavior belongs in `docs/METHOD.md`.
- Code and data boundaries belong in `docs/ARCHITECTURE.md`.
- Branch, review, and merge rules belong in `docs/CONTRIBUTING.md`.
- Deployment, backup, restore, and profile procedures belong in `docs/OPERATIONS.md`.
- Short-lived status and follow-up work belong in `docs/HANDOFF.md`.

Do not duplicate a rule across documents. Link to its canonical source instead.

## Fast path

This is a two-person hobby project. Prefer momentum over ceremony while keeping GitHub as the source of truth.

- Give one short progress update, then work. Add another only at a meaningful milestone or when blocked.
- For low-risk changes, run the narrowest useful local check once and let GitHub CI run the full suite once.
- Do not repeat an unchanged test/build after a clean rebase or merge unless the tree changed or CI disagrees.
- Open a ready PR, do not request a reviewer by default, and squash merge as soon as CI passes. Ask for review only when Roman explicitly requests it or the change is genuinely high-risk.
- Auth, database migration, restore, and deployment changes still require focused tests and a real health check.

## Codex browser access

- Run `npm run dev:codex` for isolated local visual testing. It loads the ignored `.env.codex.local`, uses separate data under `.data/codex-browser`, disables paid APIs, selects Roman, and pre-fills the local PIN.
- Open `http://127.0.0.1:4183/` and press Enter on the pre-filled Roman login. Do not ask Roman for the PIN again.
- Reuse an authenticated browser session when available. Use production only for read-only smoke tests unless the task explicitly authorizes a mutation.
- Do not add an authentication bypass.

## Change rules

- Do not commit or push directly to `main`. Use `roman/<topic>`, `oliver/<topic>`, or `codex/<topic>`.
- Keep one task and one author per branch. Do not share a working branch between Roman and Oliver.
- Deliver source changes through a pull request and squash merge after CI; a second-person review is optional.
- Do not edit production application files manually. Production receives CI-checked commits from GitHub only.
- Never commit `.env`, PINs, API keys, SQLite databases, audio, backups, or profile registries.
- Preserve product invariants and API behavior unless the task explicitly changes them.
- Preserve the desktop keyboard path and an equivalent visible touch path; do not expand unrelated work into a PWA or native refactor.
- Keep changes surgical. Do not clean up unrelated code or reformat unrelated files.
- Prefer feature/domain modules over generic dumping grounds. Shared code must serve at least two domains.
- Run checks in proportion to risk. CI remains the final full test/build gate for runtime changes.

If current repository state conflicts with these instructions, stop, preserve the state, and describe the conflict instead of guessing.
