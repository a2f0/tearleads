#!/bin/sh
# Static inventory for vault-prod server
#
# Using public IP temporarily until Tailscale connectivity is resolved.
# The old "vault-prod" device should be removed from Tailscale admin console
# and "vault-prod-1" renamed to "vault-prod".
#
# Username can be overridden via VAULT_SSH_USER env var.

USERNAME="${VAULT_SSH_USER:-${TF_VAR_server_username:-deploy}}"

cat <<EOF
{
  "all": {
    "hosts": ["65.108.51.185"],
    "vars": {
      "ansible_user": "$USERNAME"
    }
  },
  "_meta": {
    "hostvars": {}
  }
}
EOF
