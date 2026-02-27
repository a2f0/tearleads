#!/bin/bash
# Fetch secrets from Vault and write to .secrets directory
# Inverse of migrate-secrets.sh
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
  echo "  ANDROID_KEY_ALIAS Keystore alias override (default: tearleads)"
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

read_env_file_value() {
  local env_file="$1"
  local key="$2"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  local line
  line=$(grep -E "^(export[[:space:]]+)?${key}=" "$env_file" | tail -n 1) || return 1
  line="${line#export }"
  line="${line#${key}=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

get_keystore_store_pass() {
  if [[ -n "${ANDROID_KEYSTORE_STORE_PASS:-}" ]]; then
    printf '%s' "$ANDROID_KEYSTORE_STORE_PASS"
    return 0
  fi
  read_env_file_value "$SECRETS_DIR/root.env" "ANDROID_KEYSTORE_STORE_PASS"
}

get_keystore_key_pass() {
  if [[ -n "${ANDROID_KEYSTORE_KEY_PASS:-}" ]]; then
    printf '%s' "$ANDROID_KEYSTORE_KEY_PASS"
    return 0
  fi
  read_env_file_value "$SECRETS_DIR/root.env" "ANDROID_KEYSTORE_KEY_PASS"
}

validate_keystore_file() {
  local file_path="$1"
  local context="$2"
  local alias="${ANDROID_KEY_ALIAS:-tearleads}"
  local store_pass
  local key_pass
  store_pass="$(get_keystore_store_pass || true)"
  key_pass="$(get_keystore_key_pass || true)"

  if [[ -z "$store_pass" || -z "$key_pass" ]]; then
    echo "ERROR: $context failed: missing ANDROID_KEYSTORE_STORE_PASS/ANDROID_KEYSTORE_KEY_PASS (env or $SECRETS_DIR/root.env)." >&2
    return 1
  fi
  if ! command -v keytool >/dev/null 2>&1; then
    echo "ERROR: $context failed: keytool not found." >&2
    return 1
  fi
  if ! keytool -list -keystore "$file_path" -storepass "$store_pass" -alias "$alias" -keypass "$key_pass" >/dev/null 2>&1; then
    echo "ERROR: $context failed: keytool could not read alias '$alias' from keystore." >&2
    return 1
  fi
}

is_keystore_name() {
  local name="$1"
  [[ "$name" == *.keystore ]]
}

# Check for vault token
if [[ -z "${VAULT_TOKEN:-}" ]]; then
  if [[ -f "$VAULT_KEYS_FILE" ]]; then
    export VAULT_TOKEN=$(jq -r '.root_token // empty' "$VAULT_KEYS_FILE")
  elif [[ -f ~/.vault-token ]]; then
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
  tmp_decoded="$(mktemp)"

  case "$encoding" in
    base64)
      if ! printf '%s' "$content" | base64 -d > "$tmp_decoded"; then
        rm -f "$tmp_decoded"
        echo "ERROR: Failed to decode base64 content for $vault_path" >&2
        exit 1
      fi
      ;;
    json|text)
      printf '%s\n' "$content" > "$tmp_decoded"
      ;;
    *)
      echo "  WARNING: Unknown encoding '$encoding', treating as text" >&2
      printf '%s\n' "$content" > "$tmp_decoded"
      ;;
  esac

  if is_keystore_name "$secret_name"; then
    validate_keystore_file "$tmp_decoded" "Vault secret $vault_path" || {
      rm -f "$tmp_decoded"
      exit 1
    }
  fi

  if [[ -f "$output_file" ]]; then
    if cmp -s "$tmp_decoded" "$output_file"; then
      echo "[OK] $secret_name (unchanged)"
      ((++UNCHANGED))
    elif [[ "$FORCE" == "true" ]]; then
      echo "[UPDATE] $vault_path -> $output_file ($encoding)"
      cp "$tmp_decoded" "$output_file"
      chmod 600 "$output_file"
      ((++WRITTEN))
    else
      echo "[INCOMING] $secret_name (remote differs, use -f to overwrite)"
      ((++INCOMING))
    fi
  else
    if [[ "$FORCE" == "true" ]]; then
      echo "[NEW] $vault_path -> $output_file ($encoding)"
      cp "$tmp_decoded" "$output_file"
      chmod 600 "$output_file"
      ((++WRITTEN))
    else
      echo "[NEW] $secret_name (not on disk, use -f to write)"
      ((++NEW))
    fi
  fi
  rm -f "$tmp_decoded"
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
