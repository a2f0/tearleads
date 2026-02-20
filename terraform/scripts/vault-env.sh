#!/bin/bash
# Wrapper script to run commands with secrets loaded from Vault
# Usage: ./vault-env.sh [environment] [command...]
# Example: ./vault-env.sh staging terraform apply
#          ./vault-env.sh prod ./deploy.sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"

usage() {
  echo "Usage: $0 <environment> <command...>"
  echo ""
  echo "Environments: staging, prod"
  echo ""
  echo "Examples:"
  echo "  $0 staging terraform plan"
  echo "  $0 prod ./scripts/deploy.sh"
  echo ""
  echo "Environment variables:"
  echo "  VAULT_ADDR   - Vault server address (default: http://vault-prod:8200)"
  echo "  VAULT_TOKEN  - Vault token (or use ~/.vault-token)"
  exit 1
}

if [[ $# -lt 2 ]]; then
  usage
fi

ENV="$1"
shift

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "ERROR: Invalid environment '$ENV'. Must be 'staging' or 'prod'."
  exit 1
fi

# Check for vault token
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f ~/.vault-token ]]; then
    export VAULT_TOKEN=$(cat ~/.vault-token)
  else
    echo "ERROR: No VAULT_TOKEN set and ~/.vault-token not found."
    echo "Login first: vault login"
    exit 1
  fi
fi

# Check vault connectivity
if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
  echo "Check VAULT_ADDR and login: vault login"
  exit 1
fi

SECRET_PATH="secret/$ENV/env"

# Check if secret path exists
if ! vault kv get "$SECRET_PATH" >/dev/null 2>&1; then
  echo "WARNING: No secrets found at $SECRET_PATH. Running without Vault secrets."
  exec "$@"
fi

echo "==> Loading secrets from $SECRET_PATH"

# Export all key-value pairs as environment variables
eval "$(vault kv get -format=json "$SECRET_PATH" | jq -r '
  .data.data // {} | to_entries | .[] |
  "export \(.key)=\(.value | @sh)"
')"

echo "==> Running: $*"
exec "$@"
