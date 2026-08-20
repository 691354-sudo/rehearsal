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
- Follow the delivery contract in `docs/CONTRIBUTING.md`: open a ready PR and squash merge after CI unless Roman explicitly asks for a draft, PR-only delivery, or no merge. Do not leave routine completed work waiting in a draft or for an unrequested reviewer.
- When Roman asks to ship or put a change in production, continue through the production delivery gate in `docs/OPERATIONS.md`. A pushed branch, open PR, or merge alone is not completion.
- Auth, database migration, restore, and deployment changes still require focused tests and the operational checks defined in `docs/OPERATIONS.md`.

## Codex browser access

- Run `npm run dev:codex` for isolated local visual testing. It loads the ignored `.env.codex.local`, uses separate data under `.data/codex-browser`, disables paid APIs, selects Roman, and pre-fills the local PIN.
- Open `http://127.0.0.1:4183/` and click the enabled `Continue as Roman` button. Do not ask Roman for the PIN again.
- Reuse an authenticated browser session when available. Use production only for read-only smoke tests unless the task explicitly authorizes a mutation.
- Do not add an authentication bypass.

## Design skill routing

- Use `design-arc:design-arc` for product or multi-screen journey decisions. After its setup and objective gates, treat `docs/METHOD.md` and `docs/MOBILE_APP_DIRECTION.md` as binding constraints.
- Use `impeccable` in Operate mode for approved screen-level design, implementation, and refinement. Do not run its `init` or `document` commands or create `PRODUCT.md` or `DESIGN.md` unless Roman explicitly authorizes a new canonical document.
- Use `web-design-guidelines` for the final independent UI, accessibility, and UX review. Normally use one design skill for a narrow task and no more than three for broad redesign work.
- `interface-design` is not the default for Rehearsal; use it only when explicitly requested for a compatible interface-craft task.

## Change rules

- Do not commit or push directly to `main`. Use `roman/<topic>`, `oliver/<topic>`, or `codex/<topic>`.
- Keep one task and one author per branch. Do not share a working branch between Roman and Oliver.
- Deliver source changes through the completion contract in `docs/CONTRIBUTING.md`; a second-person review is not a default merge gate.
- Do not edit production application files manually. Production receives CI-checked commits from GitHub only.
- Never commit `.env`, PINs, API keys, SQLite databases, audio, backups, or profile registries.
- Preserve product invariants and API behavior unless the task explicitly changes them.
- Preserve the desktop keyboard path and an equivalent visible touch path; do not expand unrelated work into a PWA or native refactor.
- Keep changes surgical. Do not clean up unrelated code or reformat unrelated files.
- Prefer feature/domain modules over generic dumping grounds. Shared code must serve at least two domains.
- Run checks in proportion to risk. CI remains the final full test/build gate for runtime changes.

If current repository state conflicts with these instructions, stop, preserve the state, and describe the conflict instead of guessing.
