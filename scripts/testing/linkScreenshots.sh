#!/bin/sh
set -e

# Link this clone's .screenshots to the shared screenshot store when it has
# none, before the website stages screenshots. Without it, a website build, dev
# server, or deploy from a fresh clone or worktree finds no captures and
# publishes an empty gallery. A clone that already has .screenshots, or a
# machine without the take-screenshots skill (CI), is left as it is.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../.." && pwd -P)"

# shellcheck source=scripts/lib/screenshotsStore.sh
. "$REPO_ROOT/scripts/lib/screenshotsStore.sh"
screenshots_store_link "$REPO_ROOT"
