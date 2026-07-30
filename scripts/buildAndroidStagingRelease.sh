#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
# shellcheck source=scripts/nativeRelease.sh
. "$SCRIPT_DIR/nativeRelease.sh"

native_release_main android build staging "$@"
