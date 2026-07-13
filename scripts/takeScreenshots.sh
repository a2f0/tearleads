#!/bin/sh
set -e

# Capture app screenshots for the web (windowed) and mobile (compact) layouts.
# Writes PNGs to the gitignored .screenshots/{web,mobile}/ at the repo root.
# Extra args are forwarded to Playwright, e.g. `--project=mobile`.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../packages/app-web"

bun run screenshots "$@"
