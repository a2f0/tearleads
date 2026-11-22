#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/admin/makeRoot.sh <local|staging|prod> <fingerprint>

Grants root (the /root operator routes and root console) to the identity
registered with the 64-character lowercase hex signing key fingerprint, using
the API CLI's make-admin command. The change is recorded in the root audit
trail; a run against an identity that is already root changes nothing.

With local, the CLI uses the inherited Postgres environment or the development
defaults. With staging or prod, it uses the tier's migration login from its
Postgres Terraform stack output, as the API deploy does.
EOF
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    return 0
  fi
  if [[ $# -ne 2 ]]; then
    usage >&2
    return 1
  fi

  local tier="$1"
  local fingerprint="$2"
  case "$tier" in
    local | staging | prod) ;;
    *)
      usage >&2
      return 1
      ;;
  esac
  # The CLI validates too; checking first keeps a typo from loading the tier's
  # secrets and writing its database login to disk.
  if [[ ! "$fingerprint" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Error: Fingerprint must be the 64-character lowercase hex signing key fingerprint" >&2
    return 1
  fi

  local repo_root
  unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
  repo_root="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

  if [[ "$tier" == local ]]; then
    cd "$repo_root/packages/api-cli"
    exec bun src/index.ts make-admin "$fingerprint"
  fi

  umask 077
  local connection_json
  connection_json="$(mktemp "${TMPDIR:-/tmp}/tearleads-${tier}-postgres-XXXXXX")"
  # The trap runs after main returns, so it must capture the path now.
  # shellcheck disable=SC2064
  trap "rm -f '$connection_json'" EXIT
  "$repo_root/terraform/scripts/run-postgres-stack.sh" "$tier" output -json api_connection >"$connection_json"

  (
    # The password assignment must not appear in a traced run; the subshell
    # keeps the change local.
    if [[ "$-" == *x* ]]; then
      set +x
    fi
    # The shared database module prefers a connection URL over the parts, so an
    # inherited development URL must not steer the change elsewhere.
    unset DATABASE_URL POSTGRES_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
    cd "$repo_root/packages/api-cli"
    export NODE_ENV=production
    export API_DATABASE=postgres
    export POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE
    POSTGRES_HOST="$(jq -r '.postgres_host // ""' "$connection_json")"
    POSTGRES_PORT="$(jq -r '.postgres_migration_port // ""' "$connection_json")"
    POSTGRES_USER="$(jq -r '.postgres_migration_user // ""' "$connection_json")"
    POSTGRES_PASSWORD="$(jq -r '.postgres_migration_password // ""' "$connection_json")"
    POSTGRES_DATABASE="$(jq -r '.postgres_db // ""' "$connection_json")"
    export POSTGRES_SSL=true
    export POSTGRES_SSL_REJECT_UNAUTHORIZED=true
    exec bun src/index.ts make-admin "$fingerprint"
  )
}

main "$@"
