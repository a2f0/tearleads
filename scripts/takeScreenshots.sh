#!/bin/sh
set -e

# Capture app screenshots for the web (windowed), mobile (compact), and
# authenticated two-peer collaboration layouts, in both light and dark themes.
# Writes PNGs below the gitignored .screenshots/{web,mobile,collaboration}/ at
# the repo root.
# Extra args are forwarded to Playwright, e.g. `--project=mobile`.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../packages/app-web" || exit 1

bun run screenshots "$@"
