#!/bin/bash
# Create a Raft snapshot backup of Vault
# The snapshot is a single encrypted file containing all secrets
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/.secrets/vault-backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/vault-snapshot-$TIMESTAMP.snap"

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  -o, --output FILE   Output file path (default: .secrets/vault-backups/vault-snapshot-TIMESTAMP.snap)"
  echo "  -h, --help          Show this help"
  echo ""
  echo "Environment variables:"
  echo "  VAULT_USERNAME - Username for userpass auth (optional)"
  echo "  VAULT_PASSWORD - Password for userpass auth (optional)"
  echo "  VAULT_ADDR   - Vault server address (default: http://vault-prod:8200)"
  echo "  VAULT_TOKEN  - Vault token (or use ~/.vault-token)"
  echo "  BACKUP_DIR   - Backup directory (default: .secrets/vault-backups)"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -o|--output)
      BACKUP_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Raft snapshots require elevated privileges; use root token from vault-keys.json.
VAULT_KEYS_FILE="$REPO_ROOT/.secrets/vault-keys.json"
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f "$VAULT_KEYS_FILE" ]]; then
    export VAULT_TOKEN
    VAULT_TOKEN=$(jq -r .root_token "$VAULT_KEYS_FILE")
  elif [[ -f ~/.vault-token ]]; then
    export VAULT_TOKEN=$(cat ~/.vault-token)
  else
    echo "ERROR: No VAULT_TOKEN, ~/.vault-token, or $VAULT_KEYS_FILE found."
    exit 1
  fi
fi

# Check vault connectivity
if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
  exit 1
fi

# Create backup directory
mkdir -p "$(dirname "$BACKUP_FILE")"

echo "==> Creating Vault Raft snapshot..."
echo "    Source: $VAULT_ADDR"
echo "    Output: $BACKUP_FILE"

vault operator raft snapshot save "$BACKUP_FILE"

# Get file size
SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

echo ""
echo "==> Backup complete!"
echo "    File: $BACKUP_FILE"
echo "    Size: $SIZE"
echo ""
echo "Store this file securely. It contains all Vault secrets (encrypted)."
echo "To restore: ./restore.sh -i $BACKUP_FILE"
