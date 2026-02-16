#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/tf.sh <command> [args...]

Common commands:
  init        Run ./scripts/init.sh
  plan        Run ./scripts/plan.sh
  apply       Run ./scripts/apply.sh
  import      Run ./scripts/import.sh

Any other command is passed directly to:
  terraform -chdir=<stack> <command> [args...]
EOF
}

ensure_github_token() {
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: gh CLI is required to load GITHUB_TOKEN automatically." >&2
    echo "Install gh or export GITHUB_TOKEN manually." >&2
    exit 1
  fi

  local token
  if ! token="$(gh auth token 2>/dev/null)"; then
    echo "ERROR: Unable to read token from gh auth session." >&2
    echo "Run: gh auth login" >&2
    exit 1
  fi

  if [[ -z "$token" ]]; then
    echo "ERROR: gh returned an empty token." >&2
    echo "Run: gh auth login" >&2
    exit 1
  fi

  export GITHUB_TOKEN="$token"
}

main() {
  local command="${1:-help}"

  case "$command" in
    -h|--help|help)
      print_usage
      return 0
      ;;
  esac

  ensure_github_token

  case "$command" in
    init|plan|apply|import)
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
