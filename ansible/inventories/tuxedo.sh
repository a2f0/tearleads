#!/bin/sh
# Dynamic inventory script for the Tuxedo server from its Terraform output
set -e

cd "$(dirname "$0")/../../tuxedo/terraform"

if [ -n "${TF_WORKSPACE_TUXEDO:-}" ]; then
  export TF_WORKSPACE="$TF_WORKSPACE_TUXEDO"
fi

HOSTNAME=$(terraform output -raw dns_hostname 2>/dev/null)
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
