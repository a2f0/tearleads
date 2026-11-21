#!/bin/sh
set -e

# Capture app screenshots for the windowed desktop, iPhone, and iPad layouts in
# both light and dark themes. Authenticated two-peer scenarios are captured by
# separate Playwright projects but written into these same three collections.
# In an unlinked clone this writes PNGs below the gitignored
# .screenshots/{web,mobile,ipad}/ at repo root. Mobile captures use the iPhone
# 13 browser viewport with touch input at 3x resolution. Phone and iPad PNGs
# have the display's rounded corners cut out (transparent) and leave out the
# test-deployment banner; the website adds the bezel.
# Extra args are forwarded to Playwright, e.g. `--project=mobile`.
#
# A clone with no .screenshots is linked to the shared screenshot store first
# when the take-screenshots skill is installed. A linked clone's .screenshots is
# a symlink into that store, where only the skill's `artifacts capture` may
# write, so the capture is delegated to it there; an unlinked clone (no skill,
# or a local capture a person has not yet moved into the store) keeps a plain
# local .screenshots directory and captures directly.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

# shellcheck source=scripts/lib/screenshotsStore.sh
. "$REPO_ROOT/scripts/lib/screenshotsStore.sh"
screenshots_store_link "$REPO_ROOT"

if [ -L "$REPO_ROOT/.screenshots" ]; then
  artifacts=$(screenshots_store_script) || {
    cat >&2 <<'EOF'
.screenshots links to the shared screenshot store, so this script cannot
capture directly. Install the take-screenshots skill, or point
TAKE_SCREENSHOTS_ARTIFACTS at its scripts/artifacts.ts, then capture through
`artifacts capture --apply`, which locks the store and records the capture.
EOF
    exit 1
  }
  cd "$REPO_ROOT" || exit 1
  exec bun "$artifacts" capture --apply -- "$@"
fi

cd "$REPO_ROOT/packages/app-web" || exit 1

bun run screenshots "$@"
