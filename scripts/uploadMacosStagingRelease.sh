#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/desktopRelease.sh
. "$SCRIPT_DIR/lib/desktopRelease.sh"

desktop_release_main macos upload staging "$@"
