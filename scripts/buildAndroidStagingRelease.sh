#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/lib/nativeRelease.sh
. "$SCRIPT_DIR/lib/nativeRelease.sh"

native_release_main android build staging "$@"
