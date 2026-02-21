#!/bin/bash
# Run a command with secrets from Vault injected as environment variables
# Secrets are ephemeral - only available for the duration of the command
#
# Usage: vault-env.sh <vault-path> [<vault-path>...] -- <command> [args...]
#
# Examples:
#   vault-env.sh secret/env/aws -- terraform apply
#   vault-env.sh secret/env/aws secret/env/cloudflare -- ./apply.sh
#
# The vault path should contain key-value pairs that become env vars:
#   vault kv put secret/env/aws AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=yyy
#
# Requires:
#   - VAULT_ADDR (defaults to http://vault-prod:8200)
#   - VAULT_TOKEN or ~/.vault-token
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"
export VAULT_ADDR

usage() {
  echo "Usage: vault-env.sh <vault-path> [<vault-path>...] -- <command> [args...]"
  echo ""
  echo "Examples:"
  echo "  vault-env.sh secret/env/aws -- terraform apply"
  echo "  vault-env.sh secret/env/aws secret/env/cloudflare -- ./apply.sh"
  exit 1
}

# Collect vault paths until we hit --
VAULT_PATHS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      ;;
    *)
      VAULT_PATHS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#VAULT_PATHS[@]} -eq 0 ]]; then
  echo "ERROR: No vault paths specified" >&2
  usage
fi

if [[ $# -eq 0 ]]; then
  echo "ERROR: No command specified after --" >&2
  usage
fi

# Check for vault token
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f ~/.vault-token ]]; then
    VAULT_TOKEN=$(cat ~/.vault-token)
    export VAULT_TOKEN
  else
    echo "ERROR: No VAULT_TOKEN set and ~/.vault-token not found." >&2
    exit 1
  fi
fi

# Verify vault connectivity
if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid." >&2
  exit 1
fi

# Fetch secrets from each path and export as env vars
for vault_path in "${VAULT_PATHS[@]}"; do
  # Get all key-value pairs from the secret
  SECRET_JSON=$(vault kv get -format=json "$vault_path" 2>/dev/null) || {
    echo "ERROR: Failed to read secret at $vault_path" >&2
    exit 1
  }

  # Extract the data and export each key as an env var
  # Uses @sh to safely escape values (handles newlines, special chars)
  # Filters to only valid shell identifiers (skips keys with dots, dashes, etc.)
  # Supports both KV v1 (.data) and v2 (.data.data) engines
  EXPORT_CMDS=$(jq -r '
    (.data.data // .data) | to_entries[] |
    select(.key | test("^[a-zA-Z_][a-zA-Z0-9_]*$")) |
    "export \(.key)=\(.value | @sh)"
  ' <<< "$SECRET_JSON")
  eval "$EXPORT_CMDS"
done

# Execute the command with the injected environment
exec "$@"
