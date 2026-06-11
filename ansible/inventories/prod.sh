#!/bin/sh
# Dynamic inventory script for the prod server from its Terraform output
# The runner script (run-server-prod.sh) handles loading secrets and
# initializing the Terraform backend before invoking ansible-playbook.

STACK_DIR="$(dirname "$0")/../../terraform/stacks/prod/server"

cd "$STACK_DIR" 2>/dev/null || {
  echo '{"_meta": {"hostvars": {}}}'
  exit 0
}

TF_STDERR=$(mktemp 2>/dev/null) || TF_STDERR=/dev/null
HOSTNAME=$(terraform output -raw ssh_hostname 2>"$TF_STDERR") || true
USERNAME=$(terraform output -raw server_username 2>>"$TF_STDERR") || true

if [ -n "$TF_STDERR" ] && [ "$TF_STDERR" != "/dev/null" ]; then
  if grep -qv "No outputs found\|output.*not found" "$TF_STDERR" 2>/dev/null && [ -s "$TF_STDERR" ]; then
    cat "$TF_STDERR" >&2
  fi
  rm -f "$TF_STDERR"
fi

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
