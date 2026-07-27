#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/listGarageBucketKeys.sh <staging|prod> [prefix] [--with-size]

Lists object keys in the Garage-backed blob bucket for the selected server.
The optional prefix limits the S3 ListObjectsV2 request.
Pass --with-size to prefix each line with the object size as "<size>\t<key>".

Set GARAGE_SSH_TARGET=user@host to override Tailscale SSH resolution.
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: $command_name is required." >&2
    exit 1
  fi
}

shell_quote() {
  local value=${1//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

resolve_garage_ssh_target() {
  local stack_dir="$1"

  if [[ -n "${GARAGE_SSH_TARGET:-}" ]]; then
    wait_for_ssh_ready "$GARAGE_SSH_TARGET" >&2 || return 1
    echo "$GARAGE_SSH_TARGET"
    return 0
  fi

  resolve_stack_ssh_target "$stack_dir"
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    return 0
  fi

  local with_size=""
  local positionals=()
  local arg
  for arg in "$@"; do
    if [[ "$arg" == "--with-size" ]]; then
      with_size="--with-size"
    else
      positionals+=("$arg")
    fi
  done

  local tier="${positionals[0]:-}"
  local prefix="${positionals[1]:-}"

  if [[ "$tier" != "staging" && "$tier" != "prod" ]]; then
    usage >&2
    exit 1
  fi

  if [[ ${#positionals[@]} -gt 2 ]]; then
    usage >&2
    exit 1
  fi

  require_command git
  require_command ssh
  require_command terraform

  local repo_root stack_dir backend_config ssh_target remote_prefix_arg remote_with_size_arg
  repo_root="$(git rev-parse --show-toplevel)"

  # shellcheck source=../terraform/scripts/common.sh
  # shellcheck disable=SC1091
  . "$repo_root/terraform/scripts/common.sh"

  load_secrets_env "$tier"
  validate_aws_env

  stack_dir="$repo_root/terraform/stacks/$tier/server"
  backend_config="$(get_backend_config)"

  terraform -chdir="$stack_dir" init -input=false -no-color -backend-config="$backend_config" >&2
  ssh_target="$(resolve_garage_ssh_target "$stack_dir")"
  remote_prefix_arg="$(shell_quote "$prefix")"
  remote_with_size_arg="$(shell_quote "$with_size")"

  echo "Listing Garage bucket keys for $tier via $ssh_target..." >&2

  # shellcheck disable=SC2029
  ssh "$ssh_target" "/bin/sh -s -- $remote_prefix_arg $remote_with_size_arg" <<'SH'
set -eu
set -a
. /etc/tearleads/api.env
set +a

prefix="${1:-}"
with_size="${2:-}"

set -- blob-store:list-keys
if [ -n "$prefix" ]; then
  set -- "$@" --prefix "$prefix"
fi
if [ -n "$with_size" ]; then
  set -- "$@" "$with_size"
fi

exec /opt/tearleads/bin/tearleads-api-cli "$@"
SH
}

main "$@"
