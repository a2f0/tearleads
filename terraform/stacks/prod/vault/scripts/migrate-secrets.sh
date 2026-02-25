#!/bin/bash
# Migrate .secrets files to Vault
# Stores files under secret/files/<filename>
# Binary files are base64 encoded, text files stored as-is
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"
VAULT_KEYS_FILE="$REPO_ROOT/.secrets/vault-keys.json"

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"
SECRETS_DIR="${SECRETS_DIR:-$REPO_ROOT/.secrets}"
VAULT_PATH_PREFIX="secret/files"

usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Migrates files from .secrets/ to Vault"
  echo ""
  echo "Options:"
  echo "  -d, --dry-run       Show what would be migrated without doing it"
  echo "  -f, --force         Write all secrets even if unchanged"
  echo "  -s, --secrets-dir   Source directory (default: .secrets)"
  echo "  -h, --help          Show this help"
  echo ""
  echo "Idempotency:"
  echo "  By default, each secret is compared against the existing value in Vault."
  echo "  Only new or changed secrets are written. Use -f to force write all."
  echo ""
  echo "File storage:"
  echo "  - Binary files (.keystore, .p8): stored as base64 at secret/files/<name>"
  echo "  - JSON files: stored as json_content at secret/files/<name>"
  echo "  - Text/PEM files: stored as content at secret/files/<name>"
  echo ""
  echo "Excluded files:"
  echo "  - README.md"
  echo "  - vault-keys.json (contains unseal keys - keep local only)"
  echo "  - vault-backups/ directory"
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
    -f|--force)
      FORCE=true
      shift
      ;;
    -s|--secrets-dir)
      SECRETS_DIR="$2"
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

if [[ ! -d "$SECRETS_DIR" ]]; then
  echo "ERROR: Secrets directory not found: $SECRETS_DIR"
  exit 1
fi

  # Check for vault token (unless dry run)
if [[ "$DRY_RUN" != "true" ]]; then
  if [[ -z "${VAULT_TOKEN:-}" ]]; then
    if [[ -f "$VAULT_KEYS_FILE" ]]; then
      export VAULT_TOKEN=$(jq -r '.root_token // empty' "$VAULT_KEYS_FILE")
      if [[ -z "${VAULT_TOKEN}" ]]; then
        echo "ERROR: $VAULT_KEYS_FILE exists but has no root_token."
        exit 1
      fi
    elif [[ -f ~/.vault-token ]]; then
      export VAULT_TOKEN=$(cat ~/.vault-token)
    elif [[ -n "${VAULT_USERNAME:-}" && -n "${VAULT_PASSWORD:-}" ]]; then
      vault login -method=userpass username="$VAULT_USERNAME" password="$VAULT_PASSWORD" >/dev/null
    else
      echo "ERROR: No VAULT_TOKEN, $VAULT_KEYS_FILE, ~/.vault-token, or VAULT_USERNAME/VAULT_PASSWORD set."
      exit 1
    fi
  fi

  if ! vault token lookup >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
    exit 1
  fi

  CAPABILITIES=$(vault token capabilities secret/data/files/_migrate_probe 2>/dev/null || true)
  if ! echo "$CAPABILITIES" | grep -Eq 'create|update|root|sudo'; then
    echo "ERROR: Current token cannot write to secret/data/files/* (capabilities: ${CAPABILITIES:-none})."
    echo "Use a token with write access (e.g. root token from $VAULT_KEYS_FILE)."
    exit 1
  fi
fi

# Files to exclude from migration
EXCLUDE_PATTERNS=(
  "README.md"
  "vault-keys.json"
  "vault-backups"
  ".DS_Store"
  "dev.env"
)

is_excluded() {
  local file="$1"
  local basename=$(basename "$file")
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    if [[ "$basename" == "$pattern" || "$file" == *"$pattern"* ]]; then
      return 0
    fi
  done
  return 1
}

is_binary() {
  local file="$1"
  local ext="${file##*.}"
  case "$ext" in
    keystore|p8|asc)
      return 0
      ;;
    *)
      # Check if file contains null bytes (binary indicator)
      if grep -qI . "$file" 2>/dev/null; then
        return 1  # Text file
      else
        return 0  # Binary file
      fi
      ;;
  esac
}

is_json() {
  local file="$1"
  [[ "${file##*.}" == "json" ]]
}

# Fetch the current content of a secret from Vault.
# Returns the content field value via stdout, or empty string if not found.
# Return code: 0 if secret exists, 1 if not found.
get_vault_content() {
  local path="$1"
  local existing
  existing=$(vault kv get -format=json "$path" 2>/dev/null) || return 1
  echo "$existing" | jq -r '.data.data.content // empty'
}

echo "==> Migrating secrets from $SECRETS_DIR to Vault"
echo "    Vault: $VAULT_ADDR"
echo "    Path prefix: $VAULT_PATH_PREFIX"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "    Mode: DRY RUN (no changes will be made)"
fi
echo ""

NEW=0
UPDATED=0
UNCHANGED=0
SKIPPED=0

# Find all files (not directories)
while IFS= read -r -d '' file; do
  rel_path="${file#$SECRETS_DIR/}"

  if is_excluded "$rel_path"; then
    echo "[SKIP] $rel_path (excluded)"
    ((SKIPPED++))
    continue
  fi

  # Determine storage method and vault path
  filename=$(basename "$file")
  vault_path="$VAULT_PATH_PREFIX/$filename"

  if is_binary "$file"; then
    content=$(base64 < "$file")
    encoding="base64"
  elif is_json "$file"; then
    content=$(cat "$file")
    encoding="json"
  else
    content=$(cat "$file")
    encoding="text"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY] $rel_path -> $vault_path ($encoding)"
    ((NEW++))
    continue
  fi

  # Check if secret already exists and compare content (unless --force)
  existing_content=""
  secret_exists=false
  if [[ "$FORCE" != "true" ]]; then
    if existing_content=$(get_vault_content "$vault_path"); then
      secret_exists=true
    fi
  fi

  if [[ "$FORCE" != "true" && "$secret_exists" == "true" && "$existing_content" == "$content" ]]; then
    echo "[UNCHANGED] $rel_path ($encoding)"
    ((UNCHANGED++))
  elif [[ "$secret_exists" == "true" ]]; then
    echo "[UPDATE] $rel_path -> $vault_path ($encoding)"
    vault kv put "$vault_path" \
      content="$content" \
      encoding="$encoding" \
      original_filename="$filename"
    ((UPDATED++))
  else
    echo "[NEW] $rel_path -> $vault_path ($encoding)"
    vault kv put "$vault_path" \
      content="$content" \
      encoding="$encoding" \
      original_filename="$filename"
    ((NEW++))
  fi
done < <(find -L "$SECRETS_DIR" -type f -print0)

echo ""
echo "==> Migration complete!"
echo "    New:       $NEW files"
echo "    Updated:   $UPDATED files"
echo "    Unchanged: $UNCHANGED files"
echo "    Skipped:   $SKIPPED files"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "This was a dry run. Run without -d to actually migrate."
fi
