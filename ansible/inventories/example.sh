#!/bin/sh
# Dynamic inventory script that gets the server IP from Terraform output
set -e

cd "$(dirname "$0")/../../terraform/environments/example"

HOSTNAME=$(terraform output -raw hostname 2>/dev/null)

if [ -z "$HOSTNAME" ]; then
  echo '{"_meta": {"hostvars": {}}}'
  exit 0
fi

cat <<EOF
{
  "all": {
    "hosts": ["$HOSTNAME"],
    "vars": {
      "ansible_user": "root",
      "ansible_ssh_common_args": "-o StrictHostKeyChecking=no"
    }
  },
  "_meta": {
    "hostvars": {}
  }
}
EOF
