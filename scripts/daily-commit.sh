#!/usr/bin/env bash
#
# Commit the day's work in progress, if there is any.
#
# This exists so uncommitted work does not sit in the tree for days. It is NOT
# a way to manufacture a commit history: when nothing has changed it commits
# nothing and exits quietly. An empty commit dated to look like activity would
# misrepresent when the work was done, which for a project judged on a build
# window is the one thing not worth risking.
#
# Push is attempted only if a credential is already available. It never
# prompts, and a failed push is not a failed commit -- the work is safe
# locally either way.
set -euo pipefail

REPO="${REPO:-/home/mygestor/trustagent}"
BRANCH="${BRANCH:-main}"

cd "$REPO" || exit 0

# Only act on the intended branch. A mid-rebase or detached HEAD is left alone.
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$current" != "$BRANCH" ]; then
  echo "$(date -Is) on '$current', not '$BRANCH' -- skipping"
  exit 0
fi
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then
  echo "$(date -Is) rebase or merge in progress -- skipping"
  exit 0
fi

if [ -z "$(git status --porcelain)" ]; then
  echo "$(date -Is) nothing changed -- no commit"
  exit 0
fi

git add -A

# Name the files touched, so the log says something even when unattended.
summary="$(git diff --cached --name-only | head -4 | sed 's|.*/||' | paste -sd ', ')"
count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
[ "$count" -gt 4 ] && summary="$summary, +$((count - 4)) more"

git commit -q -m "Work in progress: $summary" \
  -m "Committed automatically by scripts/daily-commit.sh on $(date -Is). Contains only files that actually changed."

echo "$(date -Is) committed $count file(s): $summary"

# Push only if it can happen without a prompt.
if git remote get-url origin >/dev/null 2>&1; then
  if GIT_TERMINAL_PROMPT=0 git push origin "$BRANCH" 2>/dev/null; then
    echo "$(date -Is) pushed to origin/$BRANCH"
  else
    echo "$(date -Is) commit is local; push needs a credential"
  fi
fi
