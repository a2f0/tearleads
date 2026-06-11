#!/bin/sh
# Dynamic inventory script for the prod server from its Terraform output
# The runner script handles loading secrets and initializing the Terraform
# backend before invoking ansible-playbook.

STACK_DIR="$(dirname "$0")/../../terraform/stacks/prod/server"

cd "$STACK_DIR" 2>/dev/null || {
  printf '{"_meta": {"hostvars": {}}}\n'
  exit 0
}

HOSTNAME=$(terraform output -raw ssh_hostname 2>/dev/null) || true
USERNAME=$(terraform output -raw server_username 2>/dev/null) || true

if [ -z "$HOSTNAME" ] || [ -z "$USERNAME" ]; then
  printf '{"_meta": {"hostvars": {}}}\n'
  exit 0
fi

printf '{
  "all": {
    "hosts": ["%s"],
    "vars": {
      "ansible_user": "%s"
    }
  },
  "_meta": {
    "hostvars": {}
  }
}\n' "$HOSTNAME" "$USERNAME"
