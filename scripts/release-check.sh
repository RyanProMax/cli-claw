#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK_CACHE="${NPM_RELEASE_CACHE:-${TMPDIR:-/tmp}/cli-claw-npm-cache}"

cd "$ROOT"

echo "==> Validate"
./scripts/validate.sh

echo
echo "==> Review"
./scripts/review.sh

echo
echo "==> CLI smoke"
node dist/cli.js help >/dev/null
node dist/cli.js --version >/dev/null

echo
echo "==> Packaging smoke"
npm --cache "$PACK_CACHE" pack --dry-run

echo
echo "Release check completed."
