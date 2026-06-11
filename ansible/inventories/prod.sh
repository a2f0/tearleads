#!/bin/sh
# Dynamic inventory script for the prod server from its Terraform output
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Source common.sh to load secrets (needed for S3 backend access)
# shellcheck source=../../terraform/scripts/common.sh
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env prod

cd "$REPO_ROOT/terraform/stacks/prod/server"

TF_STDERR=$(mktemp)
HOSTNAME=$(terraform output -raw ssh_hostname 2>"$TF_STDERR") || true
USERNAME=$(terraform output -raw server_username 2>>"$TF_STDERR") || true

# Check for real errors (not just "output not found")
if grep -qv "No outputs found\|output.*not found" "$TF_STDERR" 2>/dev/null && [ -s "$TF_STDERR" ]; then
  cat "$TF_STDERR" >&2
  rm -f "$TF_STDERR"
  exit 1
fi
rm -f "$TF_STDERR"

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  echo '{"_meta": {"hostvars": {}}}'
  exit 0
fi

cat <<EOF
{
  "all": {
    "hosts": ["$HOSTNAME"],
    "vars": {
      "ansible_user": "$USERNAME"
    }
  },
  "_meta": {
    "hostvars": {}
  }
}
EOF
