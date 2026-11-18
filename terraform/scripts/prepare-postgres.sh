#!/usr/bin/env bash
# Full deploys create the disposable staging database; production is provisioned once.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
case "${1:-}" in
  staging) exec "$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" staging apply -auto-approve ;;
  prod)
    "$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" prod output -json database >/dev/null
    echo "Production Postgres is provisioned."
    ;;
  *) echo "Usage: $(basename "$0") <staging|prod>" >&2; exit 1 ;;
esac
