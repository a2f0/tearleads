#!/bin/bash
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

source "$STACK_DIR/../../../scripts/common.sh"
validate_aws_env

terraform -chdir="$STACK_DIR" init "$@"
