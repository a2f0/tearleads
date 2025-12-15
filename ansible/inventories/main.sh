#!/bin/sh
# Dynamic inventory script that gets server info from Terraform output
set -e

cd "$(dirname "$0")/../../terraform"

HOSTNAME=$(terraform output -raw hostname 2>/dev/null)
USERNAME=$(terraform output -raw server_username 2>/dev/null)

if [ -z "$HOSTNAME" ]; then
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
