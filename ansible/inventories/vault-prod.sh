#!/bin/sh
# Dynamic inventory for vault-prod server via Tailscale
#
# Username can be overridden via VAULT_SSH_USER env var.

USERNAME="${VAULT_SSH_USER:-${TF_VAR_server_username:-deploy}}"

cat <<EOF
{
  "all": {
    "hosts": ["vault-prod"],
    "vars": {
      "ansible_user": "$USERNAME"
    }
  },
  "_meta": {
    "hostvars": {}
  }
}
EOF
