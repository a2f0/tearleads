#!/usr/bin/env bash
# Full deploys create disposable staging storage; production is provisioned once.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
case "${1:-}" in
  staging) exec "$REPO_ROOT/terraform/scripts/run-storage-stack.sh" staging apply -auto-approve ;;
  prod)
    "$REPO_ROOT/terraform/scripts/run-storage-stack.sh" prod output -json bucket >/dev/null
    echo "Production storage is provisioned."
    ;;
  *) echo "Usage: $(basename "$0") <staging|prod>" >&2; exit 1 ;;
esac
