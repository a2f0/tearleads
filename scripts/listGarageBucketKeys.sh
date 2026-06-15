#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/listGarageBucketKeys.sh <staging|prod> [prefix]

Lists object keys in the Garage-backed blob bucket for the selected server.
The optional prefix limits the S3 ListObjectsV2 request.

Set GARAGE_SSH_TARGET=user@host to bypass Terraform/Hetzner SSH resolution.
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

terraform_output_raw() {
  local stack_dir="$1"
  local output_name="$2"
  local output_value

  output_value="$(
    terraform -chdir="$stack_dir" output -no-color -raw "$output_name" 2>/dev/null ||
      true
  )"

  if [[ -z "$output_value" ||
    "$output_value" == *$'\n'* ||
    "$output_value" == *$'\033'* ||
    "$output_value" == *Warning:* ||
    "$output_value" == *Error:* ]]; then
    return 1
  fi

  printf "%s" "$output_value"
}

hcloud_server_ip_for_tier() {
  local tier="$1"
  local server_name response server_ip

  if [[ -z "${TF_VAR_hcloud_token:-}" || -z "${TF_VAR_domain:-}" ]]; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    return 1
  fi

  server_name="$tier-${TF_VAR_domain}"
  response="$(
    curl -fsS -G \
      -H "Authorization: Bearer ${TF_VAR_hcloud_token}" \
      --data-urlencode "name=$server_name" \
      "https://api.hetzner.cloud/v1/servers" 2>/dev/null ||
      true
  )"

  if [[ -z "$response" ]]; then
    return 1
  fi

  server_ip="$(jq -r '.servers[0].public_net.ipv4.ip // empty' <<<"$response")"
  if [[ -z "$server_ip" ]]; then
    echo "WARNING: no Hetzner server named $server_name was found." >&2
    return 1
  fi

  printf "%s" "$server_ip"
}

resolve_garage_ssh_target() {
  local stack_dir="$1"
  local tier="$2"
  local username hostname server_ip ssh_target

  if [[ -n "${GARAGE_SSH_TARGET:-}" ]]; then
    wait_for_ssh_ready "$GARAGE_SSH_TARGET" >&2 || return 1
    echo "$GARAGE_SSH_TARGET"
    return 0
  fi

  username="$(terraform_output_raw "$stack_dir" server_username || true)"
  username="${username:-${TF_VAR_server_username:-}}"
  hostname="$(terraform_output_raw "$stack_dir" ssh_hostname || true)"
  hostname="${hostname:-$tier}"

  if [[ -z "$username" ]]; then
    echo "ERROR: Could not resolve server username from Terraform outputs or TF_VAR_server_username." >&2
    return 1
  fi

  if [[ -n "$hostname" ]]; then
    ssh_target="$username@$hostname"
    if wait_for_ssh_ready "$ssh_target" 3 5 10 >&2; then
      echo "$ssh_target"
      return 0
    fi
    echo "WARNING: $ssh_target is not reachable; trying the public server IP." >&2
  fi

  server_ip="$(terraform_output_raw "$stack_dir" server_ip || true)"
  server_ip="${server_ip:-$(hcloud_server_ip_for_tier "$tier" || true)}"
  if [[ -n "$server_ip" ]]; then
    ssh_target="$username@$server_ip"
    wait_for_ssh_ready "$ssh_target" >&2 || return 1
    echo "$ssh_target"
    return 0
  fi

  echo "ERROR: Could not resolve a reachable SSH target for $tier." >&2
  return 1
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    return 0
  fi

  local tier="${1:-}"
  local prefix="${2:-}"

  if [[ "$tier" != "staging" && "$tier" != "prod" ]]; then
    usage >&2
    exit 1
  fi

  if [[ $# -gt 2 ]]; then
    usage >&2
    exit 1
  fi

  require_command git
  require_command ssh
  require_command terraform

  local repo_root stack_dir backend_config ssh_target remote_prefix_arg
  repo_root="$(git rev-parse --show-toplevel)"

  # shellcheck source=../terraform/scripts/common.sh
  # shellcheck disable=SC1091
  . "$repo_root/terraform/scripts/common.sh"

  load_secrets_env "$tier"
  validate_aws_env

  stack_dir="$repo_root/terraform/stacks/$tier/server"
  backend_config="$(get_backend_config)"

  terraform -chdir="$stack_dir" init -input=false -no-color -backend-config="$backend_config" >&2
  ssh_target="$(resolve_garage_ssh_target "$stack_dir" "$tier")"
  remote_prefix_arg="$(shell_quote "$prefix")"

  echo "Listing Garage bucket keys for $tier via $ssh_target..." >&2

  # shellcheck disable=SC2029
  ssh "$ssh_target" "/bin/sh -s -- $remote_prefix_arg" <<'SH'
set -eu
set -a
. /etc/tearleads/api.env
set +a

if [ -n "${1:-}" ]; then
  exec /opt/tearleads/bin/tearleads-api-cli blob-store:list-keys --prefix "$1"
fi

exec /opt/tearleads/bin/tearleads-api-cli blob-store:list-keys
SH
}

main "$@"
