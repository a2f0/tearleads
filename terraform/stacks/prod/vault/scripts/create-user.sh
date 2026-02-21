#!/bin/bash
# Create or update a Vault userpass user for file-secret access.
set -eu

export VAULT_ADDR="${VAULT_ADDR:-http://vault-prod:8200}"

DEFAULT_POLICIES="vault-files-reader"
USERNAME=""
POLICIES="$DEFAULT_POLICIES"
PASSWORD=""

usage() {
  echo "Usage: $0 -u <username> [options]"
  echo ""
  echo "Create or update a Vault userpass user."
  echo ""
  echo "Options:"
  echo "  -u, --username  Username to create (required)"
  echo "  -P, --policies  Comma-separated policy list (default: $DEFAULT_POLICIES)"
  echo "  -p, --password  Password (optional; prompts securely if omitted)"
  echo "  -h, --help      Show this help"
  echo ""
  echo "Environment:"
  echo "  VAULT_TOKEN  Vault admin token (or use ~/.vault-token)"
  echo "  VAULT_ADDR   Vault address (default: http://vault-prod:8200)"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -u|--username)
      USERNAME="$2"
      shift 2
      ;;
    -P|--policies)
      POLICIES="$2"
      shift 2
      ;;
    -p|--password)
      PASSWORD="$2"
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

if [[ -z "$USERNAME" ]]; then
  echo "ERROR: --username is required."
  usage
fi

if ! command -v vault >/dev/null 2>&1; then
  echo "ERROR: vault CLI is required."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required."
  exit 1
fi

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

if ! vault auth list -format=json | jq -e 'has("userpass/")' >/dev/null; then
  echo "ERROR: userpass auth is not enabled."
  echo "Set terraform var enable_userpass_auth=true and apply with VAULT_ADDR/VAULT_TOKEN."
  exit 1
fi

if [[ -z "$PASSWORD" ]]; then
  read -r -s -p "Password for user '$USERNAME': " PASSWORD
  echo ""
  read -r -s -p "Confirm password: " PASSWORD_CONFIRM
  echo ""
  if [[ "$PASSWORD" != "$PASSWORD_CONFIRM" ]]; then
    echo "ERROR: Passwords do not match."
    exit 1
  fi
fi

if [[ -z "$PASSWORD" ]]; then
  echo "ERROR: Password cannot be empty."
  exit 1
fi

vault write "auth/userpass/users/$USERNAME" \
  password="$PASSWORD" \
  policies="$POLICIES" >/dev/null

echo "Created/updated userpass user '$USERNAME' with policies: $POLICIES"
echo "Example login:"
echo "  export VAULT_USERNAME=$USERNAME"
echo "  export VAULT_PASSWORD='<redacted>'"
echo "  ./terraform/stacks/prod/vault/scripts/fetch-secrets.sh"
