#!/usr/bin/env bash
# Verify that generated shared mirror files are in sync.
# StreamEvent now builds from shared/dist and no longer uses copied mirrors.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

FAIL=0

check_sync() {
  local src="$1"
  shift
  for target in "$@"; do
    if [ ! -f "$target" ]; then
      echo "MISSING: $target"
      echo "  Run 'make sync-types' to generate it."
      FAIL=1
    elif ! diff -q "$src" "$target" > /dev/null 2>&1; then
      echo "OUT OF SYNC: $target"
      diff "$src" "$target" || true
      FAIL=1
    fi
  done
}

# Image detector
check_sync "$ROOT/shared/image-detector.ts"   "$ROOT/src/image-detector.ts"   "$ROOT/container/agent-runner/src/image-detector.ts"

# Channel prefixes
check_sync "$ROOT/shared/channel-prefixes.ts"   "$ROOT/src/channel-prefixes.ts"   "$ROOT/container/agent-runner/src/channel-prefixes.ts"

if [ "$FAIL" -eq 0 ]; then
  echo "All mirrored shared files are in sync."
else
  echo ""
  echo "Fix: run 'make sync-types' to re-sync mirrored files from shared/"
  exit 1
fi
