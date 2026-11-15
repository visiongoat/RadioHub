#!/bin/sh
# RadioHub main freshness guard: read/fetch only; never reset, stash or merge.
set -eu
checked_ref=${1:-HEAD}
case "$checked_ref" in
  HEAD) ;;
  *[!0-9a-fA-F]*|'') echo 'Invalid commit reference for main check.' >&2; exit 1 ;;
esac

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo 'Main check failed: run this inside the RadioHub working tree.' >&2
  exit 1
fi

echo 'Checking the latest origin/main...'
if ! GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 \
  fetch --quiet --no-tags origin '+refs/heads/main:refs/remotes/origin/main'; then
  echo 'Main could not be verified. Check network/repository access; nothing was merged or reset.' >&2
  exit 1
fi

if git merge-base --is-ancestor refs/remotes/origin/main "$checked_ref"; then
  echo 'Main check passed: the latest main is included.'
  exit 0
fi

# A merge is allowed to finish when its incoming parent contains the latest main.
# This also covers a manual commit after resolving that merge's conflicts.
if [ "$checked_ref" = HEAD ] && git rev-parse --verify --quiet MERGE_HEAD >/dev/null \
  && git merge-base --is-ancestor refs/remotes/origin/main MERGE_HEAD; then
  echo 'Main check passed: the pending merge includes the latest main.'
  exit 0
fi

echo 'Stopped: new main commits are missing from this branch.' >&2
echo 'Review origin/main and merge it without discarding local changes, then retry.' >&2
echo 'No working files, staged changes or local commits were changed by this check.' >&2
exit 1
