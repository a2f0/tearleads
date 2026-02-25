#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NVMRC_PATH="$ROOT_DIR/.nvmrc"

if [[ ! -f "$NVMRC_PATH" ]]; then
  echo "checkNodeVersion: missing .nvmrc at $NVMRC_PATH" >&2
  exit 1
fi

EXPECTED_RAW="$(tr -d '[:space:]' < "$NVMRC_PATH")"
EXPECTED="${EXPECTED_RAW#v}"
CURRENT_RAW="$(node -v)"
CURRENT="${CURRENT_RAW#v}"

if [[ "$CURRENT" != "$EXPECTED" ]]; then
  echo "checkNodeVersion: unsupported Node version $CURRENT_RAW (expected v$EXPECTED)." >&2
  echo "Run 'mise install node' in this repo, then re-run your command." >&2
  exit 1
fi
