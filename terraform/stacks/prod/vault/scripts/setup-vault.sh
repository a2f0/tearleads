#!/bin/bash
# Initialize and configure Vault server with Raft storage
# Run this once after the server is provisioned
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"
VAULT_KEYS_FILE="$REPO_ROOT/.secrets/vault-keys.json"

echo "==> Checking Vault status at $VAULT_ADDR"

# Check if vault is already initialized
if vault status 2>/dev/null | grep -q "Initialized.*true"; then
  echo "Vault is already initialized."

  if vault status 2>/dev/null | grep -q "Sealed.*true"; then
    echo "Vault is sealed. Unsealing..."
    if [[ -f "$VAULT_KEYS_FILE" ]]; then
      UNSEAL_KEY=$(jq -r '.unseal_keys_b64[0]' "$VAULT_KEYS_FILE")
      vault operator unseal "$UNSEAL_KEY" >/dev/null
      echo "Vault unsealed."
    else
      echo "ERROR: No vault-keys.json found. Manual unseal required."
      exit 1
    fi
  fi

  echo "Vault is ready."
  exit 0
fi

echo "==> Initializing Vault with Raft storage..."

# Initialize with 1 key share (single operator setup)
# For production multi-operator, increase -key-shares and -key-threshold
INIT_OUTPUT=$(vault operator init -key-shares=1 -key-threshold=1 -format=json)

# Save keys securely
mkdir -p "$(dirname "$VAULT_KEYS_FILE")"
echo "$INIT_OUTPUT" > "$VAULT_KEYS_FILE"
chmod 600 "$VAULT_KEYS_FILE"

echo "==> Vault keys saved to $VAULT_KEYS_FILE"
echo "    CRITICAL: Back up this file securely. Loss means loss of all secrets."

# Extract keys
UNSEAL_KEY=$(echo "$INIT_OUTPUT" | jq -r '.unseal_keys_b64[0]')
ROOT_TOKEN=$(echo "$INIT_OUTPUT" | jq -r '.root_token')

echo "==> Unsealing Vault..."
vault operator unseal "$UNSEAL_KEY" >/dev/null

echo "==> Logging in with root token..."
vault login "$ROOT_TOKEN" >/dev/null

echo "==> Enabling KV v2 secrets engine at secret/..."
vault secrets enable -path=secret -version=2 kv

echo "==> Creating environment paths..."
vault kv put secret/staging/env placeholder=true
vault kv put secret/prod/env placeholder=true
vault kv delete secret/staging/env >/dev/null 2>&1 || true
vault kv delete secret/prod/env >/dev/null 2>&1 || true

echo "==> Creating admin policy..."
vault policy write admin - <<EOF
# Full access to all secrets
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Manage auth methods
path "auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

# Manage policies
path "sys/policies/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# List policies
path "sys/policies/acl" {
  capabilities = ["list"]
}

# Raft snapshots for backup/restore
path "sys/storage/raft/snapshot" {
  capabilities = ["read", "update"]
}

# System health
path "sys/health" {
  capabilities = ["read"]
}
EOF

echo "==> Vault setup complete!"
echo ""
echo "Root token saved to: $VAULT_KEYS_FILE"
echo "To use Vault locally:"
echo "  export VAULT_ADDR=$VAULT_ADDR"
echo "  export VAULT_TOKEN=$(jq -r '.root_token' "$VAULT_KEYS_FILE")"
echo ""
echo "Or copy token to ~/.vault-token:"
echo "  jq -r '.root_token' $VAULT_KEYS_FILE > ~/.vault-token"
