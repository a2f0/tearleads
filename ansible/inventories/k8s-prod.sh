#!/bin/sh
# Dynamic inventory script for the prod k8s server from its Terraform output
set -e

cd "$(dirname "$0")/../../terraform/stacks/prod/k8s"

HOSTNAME=$(terraform output -raw k8s_hostname 2>/dev/null)
USERNAME=$(terraform output -raw server_username 2>/dev/null)

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
