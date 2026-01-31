#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

print_usage() {
  cat <<'USAGE'
Usage:
  scripts/makeAdmin.sh user@example.com
  scripts/makeAdmin.sh --email user@example.com

Options:
  --email, -e   Account email address (required)
  --help, -h    Show this help message
USAGE
}

if [[ ${#} -eq 0 ]]; then
  print_usage
  exit 1
fi

email=""
args=("$@")

for ((i=0; i<${#args[@]}; i++)); do
  arg="${args[$i]}"

  case "$arg" in
    -h|--help)
      print_usage
      exit 0
      ;;
    -e|--email)
      next_index=$((i + 1))
      if [[ $next_index -ge ${#args[@]} || "${args[$next_index]}" == -* ]]; then
        echo "Missing value for $arg." >&2
        exit 1
      fi
      email="${args[$next_index]}"
      i=$next_index
      ;;
    --email=*)
      email="${arg#--email=}"
      ;;
    *)
      if [[ -z "$email" && "$arg" != -* ]]; then
        email="$arg"
      else
        echo "Unknown argument: $arg" >&2
        exit 1
      fi
      ;;
  esac
 done

if [[ -z "$email" ]]; then
  echo "Email is required." >&2
  print_usage
  exit 1
fi

pnpm --filter @rapid/api exec tsx "$ROOT_DIR/packages/api/src/apiCli.ts" make-admin --email "$email"
