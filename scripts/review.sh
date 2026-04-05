#!/usr/bin/env bash
# Mechanical review helper for local milestone review gates.
# This does not replace semantic review against RUNBOOKS/Review.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

tracked_diff="$(git diff --name-only HEAD)"
staged_diff="$(git diff --name-only --cached)"
untracked_files="$(git ls-files --others --exclude-standard)"
all_changed_files="$(
  {
    printf '%s\n' "$tracked_diff"
    printf '%s\n' "$staged_diff"
    printf '%s\n' "$untracked_files"
  } | sed '/^$/d' | sort -u
)"

echo "==> Changed files"
if [ -n "$all_changed_files" ]; then
  printf '%s\n' "$all_changed_files"
else
  echo "(none)"
fi

echo
echo "==> Diff stat"
git diff --stat HEAD

if [ -n "$untracked_files" ]; then
  echo
  echo "==> Untracked files"
  printf '%s\n' "$untracked_files"
fi

echo
echo "==> Diff hygiene"
git diff --check HEAD

echo
echo "==> Format check"
set +e
format_output="$(npm run format:check 2>&1)"
format_status=$?
set -e
printf '%s\n' "$format_output"

if [ "$format_status" -ne 0 ]; then
  changed_src_files="$(
    printf '%s\n' "$all_changed_files" \
      | awk '/^src\/.*\.ts$/ { print }'
  )"

  if [ -n "$changed_src_files" ]; then
    echo
    echo "Format check failed and the current diff includes src/*.ts files. Review helper is failing so the diff can be cleaned up."
    exit "$format_status"
  fi

  echo
  echo "Format check failed on the existing repository baseline, but the current diff does not include root src/*.ts files. Continuing review helper output."
fi

echo
echo "Semantic review is still required. Complete the review gate in RUNBOOKS/Review.md before marking a milestone done."
