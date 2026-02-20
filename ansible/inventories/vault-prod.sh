#!/bin/sh
# Dynamic inventory script for the prod vault server from its Terraform output
set -e

cd "$(dirname "$0")/../../terraform/stacks/prod/vault"

# Capture stderr to detect actual errors vs missing outputs
TF_STDERR=$(mktemp)
HOSTNAME=$(terraform output -raw tailscale_hostname 2>"$TF_STDERR") || true
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
