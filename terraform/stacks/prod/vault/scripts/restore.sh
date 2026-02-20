#!/bin/bash
# Restore Vault from a Raft snapshot backup
# WARNING: This will overwrite all current Vault data
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"

usage() {
  echo "Usage: $0 -i <snapshot-file>"
  echo ""
  echo "Options:"
  echo "  -i, --input FILE   Snapshot file to restore from (required)"
  echo "  -f, --force        Skip confirmation prompt"
  echo "  -h, --help         Show this help"
  echo ""
  echo "Environment variables:"
  echo "  VAULT_ADDR   - Vault server address (default: http://vault-prod:8200)"
  echo "  VAULT_TOKEN  - Vault token (or use ~/.vault-token)"
  exit 0
}

SNAPSHOT_FILE=""
FORCE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -i|--input)
      SNAPSHOT_FILE="$2"
      shift 2
      ;;
    -f|--force)
      FORCE=true
      shift
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

if [[ -z "$SNAPSHOT_FILE" ]]; then
  echo "ERROR: Snapshot file required. Use -i <file>"
  usage
fi

if [[ ! -f "$SNAPSHOT_FILE" ]]; then
  echo "ERROR: Snapshot file not found: $SNAPSHOT_FILE"
  exit 1
fi

# Check for vault token
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f ~/.vault-token ]]; then
    export VAULT_TOKEN=$(cat ~/.vault-token)
  else
    echo "ERROR: No VAULT_TOKEN set and ~/.vault-token not found."
    exit 1
  fi
fi

# Check vault connectivity
if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
  exit 1
fi

echo "==> Restore Vault from snapshot"
echo "    Source: $SNAPSHOT_FILE"
echo "    Target: $VAULT_ADDR"
echo ""
echo "WARNING: This will OVERWRITE all current Vault data!"
echo ""

if [[ "$FORCE" != "true" ]]; then
  read -p "Type 'yes' to confirm restore: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
fi

echo "==> Restoring Vault Raft snapshot..."
vault operator raft snapshot restore -force "$SNAPSHOT_FILE"

echo ""
echo "==> Restore complete!"
echo ""
echo "Note: You may need to unseal Vault after restore if it was sealed."
echo "Use the unseal key from vault-keys.json"
