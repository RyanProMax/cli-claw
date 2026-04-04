#!/usr/bin/env bash
# Copy shared source files that still rely on mirrored local copies.
# StreamEvent now builds from shared/dist and no longer uses copied mirrors.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

sync_file() {
  local src="$1" target="$2"
  if [ ! -f "$target" ] || ! cmp -s "$src" "$target"; then
    cp "$src" "$target"
  fi
}

# --- Image detector (2 targets: backend + agent-runner; not needed by web) ---
SRC_ID="$ROOT/shared/image-detector.ts"
for target in   "$ROOT/src/image-detector.ts"   "$ROOT/container/agent-runner/src/image-detector.ts" ; do
  sync_file "$SRC_ID" "$target"
done

# --- Channel prefixes (2 targets: backend + agent-runner; not needed by web) ---
SRC_CP="$ROOT/shared/channel-prefixes.ts"
for target in   "$ROOT/src/channel-prefixes.ts"   "$ROOT/container/agent-runner/src/channel-prefixes.ts" ; do
  sync_file "$SRC_CP" "$target"
done
