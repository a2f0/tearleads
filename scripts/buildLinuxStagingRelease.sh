#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/desktopRelease.sh
. "$SCRIPT_DIR/desktopRelease.sh"

desktop_release_main linux build staging "$@"
