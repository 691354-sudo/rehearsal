# Contributing to Rehearsal

Rehearsal is maintained by Roman (`@691354-sudo`) and Oliver (`@oliverhujever`). GitHub is the source of truth for application code and release history.

## Branch workflow

1. Fetch `origin` and start from the latest `origin/main`.
2. Create a short-lived branch:
   - `roman/<topic>` for Roman;
   - `oliver/<topic>` for Oliver;
   - `codex/<topic>` for Codex-assisted work.
3. Keep one task and one author on the branch. Use a separate worktree when another task already has local changes.
4. Commit only files that belong to the task and push the branch to GitHub.
5. Open a ready pull request and complete the checklist. Use a draft only when Roman explicitly asks for one or the work is known to be incomplete. CI must pass without paid API calls.
6. Squash merge the exact CI-checked head after CI, then delete the branch. Do not wait for a second-person review unless Roman explicitly requests it or an unresolved risk requires a decision from another developer.

Do not push directly to `main`. The private repository's current GitHub plan does not enforce branch protection, so this is a team rule. If the repository moves to a plan that supports protection, require a pull request and CI; approval may remain optional for this two-person project.

## Completion contract

Unless Roman explicitly asks for a draft, PR-only delivery, or no merge, a completed implementation includes all of the following:

1. push the task branch;
2. open a ready pull request;
3. wait for required branch CI to pass;
4. squash merge the exact checked head into `main`.

Do not report the task as delivered after only pushing a branch, opening a draft, opening a ready pull request, or obtaining green branch CI. A routine completed change does not wait for an unrequested reviewer.

The words `ship`, `release`, `deploy`, `production`, `в прод`, and `залей в прод` extend this contract through the production delivery gate in [OPERATIONS.md](OPERATIONS.md). In that case, do not stop after the merge. An explicit production request authorizes the normal pull-request merge and GitHub deployment workflow for the requested change; it does not authorize unrelated server edits, secret rotation, restore, or data mutation.

If the base branch moves before merge, update the pull request and make sure CI covers the head that will actually be merged. High-risk work requires proportionate tests, rollback preparation, and operational verification; it does not silently turn a production request into PR-only delivery.

## Avoiding conflicts

- Keep task announcements and PR descriptions concise.
- Do not work together in the same branch or local worktree.
- Prefer small, reviewable PRs and merge dependent work in order.
- Rebase or merge the latest `origin/main` before final review when the base has moved.
- The branch author owns conflict resolution. Never discard the other developer's uncommitted changes.

## Optional review standard

Review is not a default merge gate. When Roman requests review or another developer must resolve an identified risk, reviewers check:

- the requested behavior and product invariants;
- database migrations, recovery, and profile isolation when data changes;
- API compatibility and validation;
- loading, empty, error, keyboard, and mobile states for UI work;
- tests, build output, secret handling, and operational documentation.

Use squash merge so `main` has one intentional commit per pull request. Production deployment is described in [OPERATIONS.md](OPERATIONS.md).
