#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Bootstrap uses local backend, no -backend-config needed
terraform -chdir="$STACK_DIR" init "$@"
