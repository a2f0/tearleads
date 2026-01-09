#!/bin/sh
set -eu
SCRIPT_DIR="$(dirname "$0")"

"$SCRIPT_DIR/../terraform/scripts/init.sh"
cd "$SCRIPT_DIR/../ansible/scripts"
./run.sh
