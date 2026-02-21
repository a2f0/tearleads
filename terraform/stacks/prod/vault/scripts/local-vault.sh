#!/bin/bash
# Bootstrap a local Vault instance from a Raft snapshot
# Useful for accessing secrets when the production Vault is unavailable
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

VAULT_KEYS_FILE="$REPO_ROOT/.secrets/vault-keys.json"
BACKUP_DIR="$REPO_ROOT/.secrets/vault-backups"
LOCAL_VAULT_DIR="${LOCAL_VAULT_DIR:-/tmp/vault-local}"
LOCAL_VAULT_PORT="${LOCAL_VAULT_PORT:-8210}"
LOCAL_VAULT_ADDR="http://127.0.0.1:$LOCAL_VAULT_PORT"

usage() {
  echo "Usage: $0 <command> [options]"
  echo ""
  echo "Commands:"
  echo "  start    Start local Vault from snapshot"
  echo "  stop     Stop local Vault and cleanup"
  echo "  status   Check if local Vault is running"
  echo ""
  echo "Options:"
  echo "  -s, --snapshot FILE   Snapshot file (default: latest in .secrets/vault-backups/)"
  echo "  -p, --port PORT       Local Vault port (default: 8210)"
  echo "  -h, --help            Show this help"
  echo ""
  echo "Environment after start:"
  echo "  export VAULT_ADDR=$LOCAL_VAULT_ADDR"
  echo "  export VAULT_TOKEN=\$(jq -r '.root_token' $VAULT_KEYS_FILE)"
  exit 0
}

COMMAND=""
SNAPSHOT_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    start|stop|status)
      COMMAND="$1"
      shift
      ;;
    -s|--snapshot)
      SNAPSHOT_FILE="$2"
      shift 2
      ;;
    -p|--port)
      LOCAL_VAULT_PORT="$2"
      LOCAL_VAULT_ADDR="http://127.0.0.1:$LOCAL_VAULT_PORT"
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

if [[ -z "$COMMAND" ]]; then
  usage
fi

find_latest_snapshot() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo ""
    return
  fi
  find "$BACKUP_DIR" -name "*.snap" -type f 2>/dev/null | sort -r | head -n1
}

cmd_status() {
  if [[ -f "$LOCAL_VAULT_DIR/vault.pid" ]]; then
    PID=$(cat "$LOCAL_VAULT_DIR/vault.pid")
    if kill -0 "$PID" 2>/dev/null; then
      echo "Local Vault is running (PID: $PID)"
      echo "  Address: $LOCAL_VAULT_ADDR"
      echo ""
      echo "To use:"
      echo "  export VAULT_ADDR=$LOCAL_VAULT_ADDR"
      echo "  export VAULT_TOKEN=\$(jq -r '.root_token' $VAULT_KEYS_FILE)"
      return 0
    fi
  fi
  echo "Local Vault is not running"
  return 1
}

cmd_stop() {
  if [[ -f "$LOCAL_VAULT_DIR/vault.pid" ]]; then
    PID=$(cat "$LOCAL_VAULT_DIR/vault.pid")
    if kill -0 "$PID" 2>/dev/null; then
      echo "Stopping local Vault (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      sleep 1
    fi
  fi

  if [[ -d "$LOCAL_VAULT_DIR" ]]; then
    echo "Cleaning up $LOCAL_VAULT_DIR..."
    rm -rf "$LOCAL_VAULT_DIR"
  fi

  echo "Local Vault stopped and cleaned up."
}

cmd_start() {
  # Check prerequisites
  if ! command -v vault >/dev/null 2>&1; then
    echo "ERROR: vault command not found. Install Vault first."
    exit 1
  fi

  if [[ ! -f "$VAULT_KEYS_FILE" ]]; then
    echo "ERROR: Vault keys file not found: $VAULT_KEYS_FILE"
    echo "Cannot unseal without the original keys."
    exit 1
  fi

  # Find snapshot
  if [[ -z "$SNAPSHOT_FILE" ]]; then
    SNAPSHOT_FILE=$(find_latest_snapshot)
    if [[ -z "$SNAPSHOT_FILE" ]]; then
      echo "ERROR: No snapshot file specified and none found in $BACKUP_DIR"
      echo "Use -s <snapshot-file> to specify one."
      exit 1
    fi
    echo "Using latest snapshot: $SNAPSHOT_FILE"
  fi

  if [[ ! -f "$SNAPSHOT_FILE" ]]; then
    echo "ERROR: Snapshot file not found: $SNAPSHOT_FILE"
    exit 1
  fi

  # Check if already running
  if cmd_status >/dev/null 2>&1; then
    echo "Local Vault is already running. Stop it first with: $0 stop"
    exit 1
  fi

  echo "==> Starting local Vault from snapshot"
  echo "    Snapshot: $SNAPSHOT_FILE"
  echo "    Data dir: $LOCAL_VAULT_DIR"
  echo "    Address:  $LOCAL_VAULT_ADDR"
  echo ""

  # Create local vault directory
  rm -rf "$LOCAL_VAULT_DIR"
  mkdir -p "$LOCAL_VAULT_DIR/data"

  # Create config file
  cat > "$LOCAL_VAULT_DIR/config.hcl" <<EOF
storage "raft" {
  path    = "$LOCAL_VAULT_DIR/data"
  node_id = "local-node"
}

listener "tcp" {
  address     = "127.0.0.1:$LOCAL_VAULT_PORT"
  tls_disable = true
}

disable_mlock = true
api_addr      = "$LOCAL_VAULT_ADDR"
cluster_addr  = "http://127.0.0.1:$((LOCAL_VAULT_PORT + 1))"
EOF

  # Start Vault in background
  echo "==> Starting Vault server..."
  vault server -config="$LOCAL_VAULT_DIR/config.hcl" \
    > "$LOCAL_VAULT_DIR/vault.log" 2>&1 &
  VAULT_PID=$!
  echo "$VAULT_PID" > "$LOCAL_VAULT_DIR/vault.pid"

  # Wait for Vault to be ready
  echo "==> Waiting for Vault to start..."
  for i in {1..30}; do
    if VAULT_ADDR="$LOCAL_VAULT_ADDR" vault status 2>/dev/null | grep -q "Initialized"; then
      break
    fi
    if ! kill -0 "$VAULT_PID" 2>/dev/null; then
      echo "ERROR: Vault process died. Check $LOCAL_VAULT_DIR/vault.log"
      cat "$LOCAL_VAULT_DIR/vault.log"
      exit 1
    fi
    sleep 0.5
  done

  export VAULT_ADDR="$LOCAL_VAULT_ADDR"

  # Initialize with temporary keys
  echo "==> Initializing Vault (temporary keys)..."
  TEMP_INIT=$(vault operator init -key-shares=1 -key-threshold=1 -format=json)
  TEMP_UNSEAL=$(echo "$TEMP_INIT" | jq -r '.unseal_keys_b64[0]')
  TEMP_TOKEN=$(echo "$TEMP_INIT" | jq -r '.root_token')

  # Unseal with temp keys
  vault operator unseal "$TEMP_UNSEAL" >/dev/null

  # Login and restore snapshot
  echo "==> Restoring Raft snapshot..."
  VAULT_TOKEN="$TEMP_TOKEN" vault operator raft snapshot restore -force "$SNAPSHOT_FILE"

  # After restore, Vault needs original unseal keys
  echo "==> Unsealing with original keys..."
  ORIGINAL_UNSEAL=$(jq -r '.unseal_keys_b64[0]' "$VAULT_KEYS_FILE")
  vault operator unseal "$ORIGINAL_UNSEAL" >/dev/null

  echo ""
  echo "==> Local Vault is ready!"
  echo ""
  echo "To use this Vault:"
  echo "  export VAULT_ADDR=$LOCAL_VAULT_ADDR"
  echo "  export VAULT_TOKEN=\$(jq -r '.root_token' $VAULT_KEYS_FILE)"
  echo ""
  echo "Example commands:"
  echo "  vault kv list secret/files"
  echo "  vault kv get secret/files/deploy.key"
  echo ""
  echo "When done, stop with: $0 stop"
}

case "$COMMAND" in
  start)
    cmd_start
    ;;
  stop)
    cmd_stop
    ;;
  status)
    cmd_status
    ;;
esac
