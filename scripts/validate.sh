#!/usr/bin/env bash
# Unified validation entrypoint for workflow milestones.
# With positional args: run the specified Vitest files first.
# Without args: run the full root test command first.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

if [ "$#" -gt 0 ]; then
  echo "==> Running targeted tests: $*"
  npm test -- "$@"
else
  echo "==> Running full test suite"
  npm test
fi

echo "==> Running make typecheck"
make typecheck

echo "==> Running npm run build"
npm run build
