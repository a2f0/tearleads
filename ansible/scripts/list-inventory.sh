#!/usr/bin/env bash
# List the Ansible inventory host for every server tier.
#
# Each tier's inventory is generated from its Terraform outputs rather than
# checked in, so this reads the same outputs run-server.sh does. Unlike
# run-server.sh it never waits on SSH — this only reports what the inventory
# would contain.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ANSIBLE_CONFIG="${SCRIPT_DIR}/../ansible.cfg"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

TIERS=(staging prod)

tier_environment() {
  case "$1" in
    prod) echo "production" ;;
    *) echo "$1" ;;
  esac
}

# Emit "<hostname> <username>" for a tier, or nothing when it is unresolvable.
# Runs in a subshell per tier so one tier's secrets never leak into the next.
#
# The caller reads this through a command substitution in an `if`, which
# disables errexit for the whole function — so every step needs its own
# `|| return 1` rather than relying on `set -e` to stop the tier.
#
# That suppression is dynamic: it reaches inside load_secrets_env too (even
# through an explicit `set -e` subshell), so a failed root.env/<tier>.env source
# there does not abort and cannot surface in its exit status. Its ERROR still
# reaches stderr, and validate_aws_env below is the postcondition that actually
# catches it — an unloaded root.env means no AWS creds, which fails the tier.
tier_host_fields() {
  local tier="$1"
  local stack_dir="$REPO_ROOT/terraform/stacks/$tier/server"
  local backend_config hostname username

  load_secrets_env "$tier" >/dev/null || return 1
  validate_aws_env || return 1

  backend_config="$(get_backend_config)" || return 1
  terraform -chdir="$stack_dir" init -backend-config="$backend_config" -input=false >/dev/null || return 1

  hostname="$(terraform -chdir="$stack_dir" output -raw ssh_hostname 2>/dev/null || true)"
  username="$(terraform -chdir="$stack_dir" output -raw server_username 2>/dev/null || true)"

  if [[ -z "$hostname" || -z "$username" ]]; then
    echo "ERROR: No ssh_hostname/server_username output in $stack_dir." >&2
    echo "       Run 'terraform apply' in that stack first." >&2
    return 1
  fi

  printf '%s %s\n' "$hostname" "$username"
}

FORMAT='%-40s %-16s %-12s\n'
# shellcheck disable=SC2059
printf "$FORMAT" HOSTNAME LOGIN ENVIRONMENT

FAILED=0
for tier in "${TIERS[@]}"; do
  if fields="$(tier_host_fields "$tier")"; then
    read -r hostname username <<<"$fields"
  else
    hostname="(unavailable)"
    username="(unavailable)"
    FAILED=1
  fi
  # shellcheck disable=SC2059
  printf "$FORMAT" "$hostname" "$username" "$(tier_environment "$tier")"
done

exit "$FAILED"
