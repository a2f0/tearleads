#!/bin/bash
# Fetch secrets from Vault and write to .secrets directory
# Inverse of migrate-secrets.sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"
SECRETS_DIR="${SECRETS_DIR:-$REPO_ROOT/.secrets}"
VAULT_PATH_PREFIX="secret/files"

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Fetches secrets from Vault to .secrets/"
  echo ""
  echo "Options:"
  echo "  -d, --dry-run       Show what would be fetched without doing it"
  echo "  -o, --output-dir    Output directory (default: .secrets)"
  echo "  -f, --force         Overwrite existing files"
  echo "  -h, --help          Show this help"
  echo ""
  echo "Environment:"
  echo "  VAULT_USERNAME   Username for userpass auth (optional)"
  echo "  VAULT_PASSWORD   Password for userpass auth (optional)"
  echo "  VAULT_TOKEN      Direct token auth (optional)"
  echo "  VAULT_ADDR       Vault address (default: http://vault-prod:8200)"
  exit 0
}

DRY_RUN=false
FORCE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -o|--output-dir)
      SECRETS_DIR="$2"
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

# Check for vault token
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f ~/.vault-token ]]; then
    export VAULT_TOKEN=$(cat ~/.vault-token)
  elif [[ -n "${VAULT_USERNAME:-}" && -n "${VAULT_PASSWORD:-}" ]]; then
    vault login -method=userpass username="$VAULT_USERNAME" password="$VAULT_PASSWORD" >/dev/null
  else
    echo "ERROR: No VAULT_TOKEN, ~/.vault-token, or VAULT_USERNAME/VAULT_PASSWORD set."
    exit 1
  fi
fi

if ! vault token lookup >/dev/null 2>&1; then
  echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
  exit 1
fi

echo "==> Fetching secrets from Vault to $SECRETS_DIR"
echo "    Vault: $VAULT_ADDR"
echo "    Path: $VAULT_PATH_PREFIX"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "    Mode: DRY RUN"
fi
echo ""

mkdir -p "$SECRETS_DIR"

FETCHED=0
SKIPPED=0

# List all secrets under the prefix
SECRETS=$(vault kv list -format=json "$VAULT_PATH_PREFIX" 2>/dev/null | jq -r '.[]' || echo "")

if [[ -z "$SECRETS" ]]; then
  echo "No secrets found at $VAULT_PATH_PREFIX"
  exit 0
fi

for secret_name in $SECRETS; do
  vault_path="$VAULT_PATH_PREFIX/$secret_name"
  output_file="$SECRETS_DIR/$secret_name"

  # Check if file exists
  if [[ -f "$output_file" && "$FORCE" != "true" ]]; then
    echo "[SKIP] $secret_name (file exists, use -f to overwrite)"
    ((++SKIPPED))
    continue
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY] $vault_path -> $output_file"
    ((++FETCHED))
    continue
  fi

  # Fetch secret metadata
  secret_data=$(vault kv get -format=json "$vault_path")
  encoding=$(echo "$secret_data" | jq -r '.data.data.encoding // "text"')
  content=$(echo "$secret_data" | jq -r '.data.data.content')

  echo "[FETCH] $vault_path -> $output_file ($encoding)"

  case "$encoding" in
    base64)
      echo "$content" | base64 -d > "$output_file"
      ;;
    json|text)
      echo "$content" > "$output_file"
      ;;
    *)
      echo "  WARNING: Unknown encoding '$encoding', treating as text"
      echo "$content" > "$output_file"
      ;;
  esac

  # Set restrictive permissions for sensitive files
  chmod 600 "$output_file"
  ((++FETCHED))
done

echo ""
echo "==> Fetch complete!"
echo "    Fetched: $FETCHED files"
echo "    Skipped: $SKIPPED files"
