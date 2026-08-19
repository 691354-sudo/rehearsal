# Rehearsal project instructions

This file is the canonical starting point for every new coding chat or developer session.

## Start here

Before changing files:

1. Run `git status --short --branch` and `git log --oneline -5`.
2. Fetch `origin` and confirm the work starts from the latest `origin/main`. Never overwrite an existing dirty worktree.
3. Read, in order:
   - `README.md` for the product and local entry points;
   - `docs/METHOD.md` for product invariants;
   - `docs/ARCHITECTURE.md` for module and data boundaries;
   - `docs/CONTRIBUTING.md` for the two-developer GitHub workflow;
   - `docs/HANDOFF.md` for the current deployed state and unfinished work.
4. For UI or mobile work, also read `docs/MOBILE_APP_DIRECTION.md` and its verification gate.
5. Read only the code and operational documentation relevant to the requested change.
6. State the goal, assumptions, and verification commands before implementation.

## Sources of truth

- Product behavior belongs in `docs/METHOD.md`.
- Code and data boundaries belong in `docs/ARCHITECTURE.md`.
- Branch, review, and merge rules belong in `docs/CONTRIBUTING.md`.
- Deployment, backup, restore, and profile procedures belong in `docs/OPERATIONS.md`.
- Short-lived status and follow-up work belong in `docs/HANDOFF.md`.

Do not duplicate a rule across documents. Link to its canonical source instead.

## Change rules

- Do not commit or push directly to `main`. Use `roman/<topic>`, `oliver/<topic>`, or `codex/<topic>`.
- Keep one task and one author per branch. Do not share a working branch between Roman and Oliver.
- Deliver source changes through a pull request. The other developer reviews it before squash merge.
- Do not edit production application files manually. Production receives reviewed commits from GitHub only.
- Never commit `.env`, PINs, API keys, SQLite databases, audio, backups, or profile registries.
- Preserve product invariants and API behavior unless the task explicitly changes them.
- Preserve the desktop keyboard path and an equivalent visible touch path; do not expand unrelated work into a PWA or native refactor.
- Keep changes surgical. Do not clean up unrelated code or reformat unrelated files.
- Prefer feature/domain modules over generic dumping grounds. Shared code must serve at least two domains.
- Run `npm test` and `npm run build` before requesting review. Run any narrower test added for the change as well.

If current repository state conflicts with these instructions, stop, preserve the state, and describe the conflict instead of guessing.
