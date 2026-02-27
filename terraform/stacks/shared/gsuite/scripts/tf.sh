#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=./auth.sh
source "$SCRIPT_DIR/auth.sh"

print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/tf.sh <command> [args...]

Common commands:
  init        Run ./scripts/init.sh
  plan        Run ./scripts/plan.sh
  apply       Run ./scripts/apply.sh

Any other command is passed directly to:
  terraform -chdir=<stack> <command> [args...]
EOF
}

main() {
  local command="${1:-help}"

  case "$command" in
    -h|--help|help)
      print_usage
      return 0
      ;;
  esac

  local env_file="$REPO_ROOT/.secrets/root.env"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$env_file"
    set +a
  fi

  hydrate_googleworkspace_auth "$REPO_ROOT"

  case "$command" in
    init|plan|apply)
      shift
      exec "$SCRIPT_DIR/$command.sh" "$@"
      ;;
    *)
      shift
      exec terraform -chdir="$STACK_DIR" "$command" "$@"
      ;;
  esac
}

main "$@"
