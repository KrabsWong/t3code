#!/usr/bin/env bash
set -euo pipefail

if git remote get-url upstream >/dev/null 2>&1; then
  REMOTE="${UPSTREAM_REMOTE:-upstream}"
else
  REMOTE="${UPSTREAM_REMOTE:-origin}"
fi
BRANCH="${UPSTREAM_BRANCH:-main}"

git fetch "$REMOTE" "$BRANCH"
git rebase "$REMOTE/$BRANCH" "$@"
if ! node scripts/no-telemetry-guard.mjs; then
  echo "[no-telemetry] rebase finished but fork invariants failed." >&2
  echo "[no-telemetry] fix the reported files, or review git status before resetting to ORIG_HEAD." >&2
  exit 1
fi
