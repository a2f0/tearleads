#!/bin/sh
set -e

# Capture app screenshots for the web (windowed) and mobile (compact) layouts,
# in both light and dark themes. Writes PNGs to the gitignored
# .screenshots/{web,mobile}/{light,dark}/ at the repo root.
# Extra args are forwarded to Playwright, e.g. `--project=mobile`.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../packages/app-web" || exit 1

bun run screenshots "$@"
