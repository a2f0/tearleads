#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <init|plan|apply|destroy> [terraform args...]" >&2
  exit 1
fi

COMMAND="$1"
shift

case "$COMMAND" in
  init)
    "$SCRIPT_DIR/init.sh" "$@"
    ;;
  plan)
    "$SCRIPT_DIR/plan.sh" "$@"
    ;;
  apply)
    "$SCRIPT_DIR/apply.sh" "$@"
    ;;
  destroy)
    "$SCRIPT_DIR/destroy.sh" "$@"
    ;;
  *)
    echo "Unsupported command: $COMMAND" >&2
    echo "Expected one of: init, plan, apply, destroy" >&2
    exit 1
    ;;
esac
