#!/bin/bash
# Migrate .secrets files to Vault
# Stores files under secret/files/<filename>
# Binary files are base64 encoded, text files stored as-is
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

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
  echo "  -s, --secrets-dir   Source directory (default: .secrets)"
  echo "  -h, --help          Show this help"
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
  exit 0
}

DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--dry-run)
      DRY_RUN=true
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
    if [[ -f ~/.vault-token ]]; then
      export VAULT_TOKEN=$(cat ~/.vault-token)
    else
      echo "ERROR: No VAULT_TOKEN set and ~/.vault-token not found."
      exit 1
    fi
  fi

  if ! vault token lookup >/dev/null 2>&1; then
    echo "ERROR: Cannot connect to Vault at $VAULT_ADDR or token is invalid."
    exit 1
  fi
fi

# Files to exclude from migration
EXCLUDE_PATTERNS=(
  "README.md"
  "vault-keys.json"
  "vault-backups"
  ".DS_Store"
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

echo "==> Migrating secrets from $SECRETS_DIR to Vault"
echo "    Vault: $VAULT_ADDR"
echo "    Path prefix: $VAULT_PATH_PREFIX"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "    Mode: DRY RUN (no changes will be made)"
fi
echo ""

MIGRATED=0
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
    storage_type="base64"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY] $rel_path -> $vault_path (base64)"
    else
      echo "[MIGRATE] $rel_path -> $vault_path (base64)"
      content=$(base64 < "$file")
      vault kv put "$vault_path" \
        content="$content" \
        encoding="base64" \
        original_filename="$filename"
    fi
  elif is_json "$file"; then
    storage_type="json"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY] $rel_path -> $vault_path (json)"
    else
      echo "[MIGRATE] $rel_path -> $vault_path (json)"
      content=$(cat "$file")
      vault kv put "$vault_path" \
        content="$content" \
        encoding="json" \
        original_filename="$filename"
    fi
  else
    storage_type="text"
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "[DRY] $rel_path -> $vault_path (text)"
    else
      echo "[MIGRATE] $rel_path -> $vault_path (text)"
      content=$(cat "$file")
      vault kv put "$vault_path" \
        content="$content" \
        encoding="text" \
        original_filename="$filename"
    fi
  fi

  ((MIGRATED++))
done < <(find "$SECRETS_DIR" -type f -print0)

echo ""
echo "==> Migration complete!"
echo "    Migrated: $MIGRATED files"
echo "    Skipped: $SKIPPED files"

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "This was a dry run. Run without -d to actually migrate."
fi
