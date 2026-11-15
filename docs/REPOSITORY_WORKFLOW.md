# Working With The Latest Main

Run `pnpm run repo:check` before starting or resuming work, including after a
break of several days. Repeat it immediately before committing, pushing or
merging. The check fetches the current `origin/main`, not a cached local copy.

If main contains commits missing from the working branch, stop and review them.
Keep existing work, merge the new main changes, resolve conflicts deliberately
and rerun the relevant tests. Never use a hard reset, discard local edits or
force-push over someone else's changes as a freshness fix.

Run `pnpm run repo:install-guards` once per local clone. This installs pre-commit
and pre-push checks in the clone's shared Git hooks directory, including
linked worktrees and GitHub Desktop commits. It does not replace an existing
hook or `core.hooksPath`. If one exists, installation stops without changing it.

The hooks fetch main on every commit attempt and branch push. A missing remote,
failed fetch or outdated branch blocks the operation. Push checks verify the
actual outgoing commit, even when it is not the checked-out branch. Tags and
branch deletions are not freshness operations. A manual merge commit that
incorporates the latest main is allowed to finish. Automatic Git merges must be
preceded by `pnpm run repo:check`; they do not run the pre-commit hook.
Checks never modify working files, stage content, stash,
reset, merge or push automatically. Installation is explicit, never part of
dependency installation, builds or application startup.

Before a GitHub merge, also check the PR's current base commit, conflicts and
required checks. Local hooks do not run in GitHub's web interface and are not a
replacement for that final check or repository branch protection.
