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
  echo "Fetches secrets from Vault and compares against .secrets/"
  echo "By default, fetches into memory and reports diffs without writing."
  echo "Use -f to actually write files."
  echo ""
  echo "Options:"
  echo "  -d, --dry-run       List secrets without fetching from Vault"
  echo "  -o, --output-dir    Output directory (default: .secrets)"
  echo "  -f, --force         Write fetched secrets to disk (overwrite existing)"
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

WRITTEN=0
UNCHANGED=0
INCOMING=0
NEW=0

# List all secrets under the prefix
SECRETS=$(vault kv list -format=json "$VAULT_PATH_PREFIX" 2>/dev/null | jq -r '.[]' || echo "")

if [[ -z "$SECRETS" ]]; then
  echo "No secrets found at $VAULT_PATH_PREFIX"
  exit 0
fi

# Decode vault content to raw bytes based on encoding
decode_content() {
  local encoding="$1"
  local content="$2"
  case "$encoding" in
    base64)
      printf '%s' "$content" | base64 -d
      ;;
    json|text)
      printf '%s\n' "$content"
      ;;
    *)
      echo "  WARNING: Unknown encoding '$encoding', treating as text" >&2
      printf '%s\n' "$content"
      ;;
  esac
}

for secret_name in $SECRETS; do
  vault_path="$VAULT_PATH_PREFIX/$secret_name"
  output_file="$SECRETS_DIR/$secret_name"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY] $vault_path -> $output_file"
    ((++NEW))
    continue
  fi

  # Fetch secret into memory
  secret_data=$(vault kv get -format=json "$vault_path")
  encoding=$(echo "$secret_data" | jq -r '.data.data.encoding // "text"')
  content=$(echo "$secret_data" | jq -r '.data.data.content')
  decoded=$(decode_content "$encoding" "$content")

  if [[ -f "$output_file" ]]; then
    # Compare in-memory content against existing file
    if cmp -s <(printf '%s' "$decoded") "$output_file"; then
      echo "[OK] $secret_name (unchanged)"
      ((++UNCHANGED))
    elif [[ "$FORCE" == "true" ]]; then
      echo "[UPDATE] $vault_path -> $output_file ($encoding)"
      printf '%s' "$decoded" > "$output_file"
      chmod 600 "$output_file"
      ((++WRITTEN))
    else
      echo "[INCOMING] $secret_name (remote differs, use -f to overwrite)"
      ((++INCOMING))
    fi
  else
    if [[ "$FORCE" == "true" ]]; then
      echo "[NEW] $vault_path -> $output_file ($encoding)"
      printf '%s' "$decoded" > "$output_file"
      chmod 600 "$output_file"
      ((++WRITTEN))
    else
      echo "[NEW] $secret_name (not on disk, use -f to write)"
      ((++NEW))
    fi
  fi
done

echo ""
echo "==> Fetch complete!"
echo "    Unchanged: $UNCHANGED files"
echo "    Incoming changes: $INCOMING files"
echo "    New (not on disk): $NEW files"
echo "    Written: $WRITTEN files"
if [[ $INCOMING -gt 0 || $NEW -gt 0 ]]; then
  echo ""
  echo "    Run with -f to apply incoming changes and write new files."
fi
