#!/usr/bin/env bash
# Full deploys create the disposable staging database; production is provisioned once.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
REPO_ROOT="$(git -C "$(dirname -- "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
case "${1:-}" in
  staging) exec "$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" staging apply -auto-approve ;;
  prod)
    "$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" prod output -json database >/dev/null
    echo "Production Postgres is provisioned."
    ;;
  *) echo "Usage: $(basename "$0") <staging|prod>" >&2; exit 1 ;;
esac
