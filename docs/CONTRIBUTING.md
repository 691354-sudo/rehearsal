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
5. Open a pull request and complete the checklist. CI must pass without paid API calls.
6. The developer who did not author the change reviews it. The author resolves comments and merge conflicts.
7. Squash merge into `main`, then delete the branch.

Do not push directly to `main`. The private repository's current GitHub plan does not enforce branch protection, so this is a team rule. If the repository moves to a plan that supports protection, require a pull request, the CI check, and one approval for `main`.

## Avoiding conflicts

- Announce the task before starting and include the affected domains in the PR description.
- Do not work together in the same branch or local worktree.
- Prefer small, reviewable PRs and merge dependent work in order.
- Rebase or merge the latest `origin/main` before final review when the base has moved.
- The branch author owns conflict resolution. Never discard the other developer's uncommitted changes.

## Review standard

Reviewers check:

- the requested behavior and product invariants;
- database migrations, recovery, and profile isolation when data changes;
- API compatibility and validation;
- loading, empty, error, keyboard, and mobile states for UI work;
- tests, build output, secret handling, and operational documentation.

Use squash merge so `main` has one intentional commit per pull request. Production deployment is described in [OPERATIONS.md](OPERATIONS.md).
