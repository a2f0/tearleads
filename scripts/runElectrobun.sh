#!/bin/sh
set -e

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
exec sh "$SCRIPT_DIR/../packages/app-electrobun/scripts/runElectronbun.sh" "$@"
