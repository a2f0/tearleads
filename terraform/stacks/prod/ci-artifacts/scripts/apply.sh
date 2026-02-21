#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
terraform -chdir="$STACK_DIR" init
terraform -chdir="$STACK_DIR" apply "$@"
