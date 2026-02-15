#!/bin/sh
# Dynamic inventory script for the k8s server from its Terraform output
set -e

cd "$(dirname "$0")/../../k8s"

if [ -n "${TF_WORKSPACE_K8S:-}" ]; then
  export TF_WORKSPACE="$TF_WORKSPACE_K8S"
fi

HOSTNAME=$(terraform output -raw hostname)
USERNAME=$(terraform output -raw server_username)

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
