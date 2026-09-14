#!/bin/sh
set -e

# Capture app screenshots for the windowed desktop, iPhone, and iPad layouts in
# both light and dark themes. Authenticated two-peer scenarios are captured by
# separate Playwright projects but written into these same three collections.
# Writes PNGs below the gitignored .screenshots/{web,mobile,ipad}/ at repo root.
# Mobile captures use the iPhone 13 browser viewport with touch input at 3x
# resolution. PNGs stay rectangular; the website adds the bezel and corners.
# Extra args are forwarded to Playwright, e.g. `--project=mobile`.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../packages/app-web" || exit 1

bun run screenshots "$@"
