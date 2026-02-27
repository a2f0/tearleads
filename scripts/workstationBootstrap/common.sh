#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck disable=SC2034 # consumed by sourced postChecks.sh
FETCH_SECRETS="${REPO_ROOT}/terraform/stacks/prod/vault/scripts/fetch-secrets.ts"
VAULT_HOST="vault-prod"
REPO_VAULT_VERSION_FILE="${REPO_ROOT}/.vault-version"
REPO_TERRAFORM_VERSION_FILE="${REPO_ROOT}/.terraform-version"
REQUIRED_TERRAFORM_VERSION=""
REQUIRED_VAULT_VERSION=""
OS=""
export VAULT_ADDR="${VAULT_ADDR:-http://${VAULT_HOST}:8200}"

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# shellcheck source=/dev/null
. "${REPO_ROOT}/scripts/lib/bootstrapToolInstallHelpers.sh"

detect_os() {
  case "$(uname -s)" in
    Darwin) OS="darwin" ;;
    Linux)
      if [ ! -f /etc/debian_version ]; then
        echo "Only Debian-based Linux distributions are supported." >&2
        exit 1
      fi
      OS="linux"
      ;;
    *)
      echo "Unsupported operating system: $(uname -s)" >&2
      exit 1
      ;;
  esac
}

terraform_version() {
  terraform version 2>/dev/null | awk 'NR==1 { print $2 }' | sed 's/^v//'
}

vault_version() {
  vault version 2>/dev/null | sed -n 's/^Vault v\([0-9][0-9.]*\).*/\1/p'
}

load_required_terraform_version() {
  if [ ! -f "$REPO_TERRAFORM_VERSION_FILE" ]; then
    echo "Missing required Terraform version file: ${REPO_TERRAFORM_VERSION_FILE}" >&2
    exit 1
  fi

  configured_version="$(sed -n '1{s/[[:space:]]//g;p;q;}' "$REPO_TERRAFORM_VERSION_FILE")"
  configured_version="${configured_version#v}"

  if [ -z "$configured_version" ]; then
    echo "Terraform version file is empty: ${REPO_TERRAFORM_VERSION_FILE}" >&2
    exit 1
  fi

  case "$configured_version" in
    *[!0-9.]* | .* | *..* | *.)
      echo "Invalid Terraform version in ${REPO_TERRAFORM_VERSION_FILE}: ${configured_version}" >&2
      exit 1
      ;;
  esac

  REQUIRED_TERRAFORM_VERSION="$configured_version"
}

terraform_matches_required_version() {
  [ "$(terraform_version)" = "$REQUIRED_TERRAFORM_VERSION" ]
}

load_required_vault_version() {
  if [ ! -f "$REPO_VAULT_VERSION_FILE" ]; then
    echo "Missing required Vault version file: ${REPO_VAULT_VERSION_FILE}" >&2
    exit 1
  fi

  configured_version="$(sed -n '1{s/[[:space:]]//g;p;q;}' "$REPO_VAULT_VERSION_FILE")"
  configured_version="${configured_version#v}"

  if [ -z "$configured_version" ]; then
    echo "Vault version file is empty: ${REPO_VAULT_VERSION_FILE}" >&2
    exit 1
  fi

  case "$configured_version" in
    *[!0-9.]* | .* | *..* | *.)
      echo "Invalid Vault version in ${REPO_VAULT_VERSION_FILE}: ${configured_version}" >&2
      exit 1
      ;;
  esac

  REQUIRED_VAULT_VERSION="$configured_version"
}

vault_matches_required_version() {
  [ "$(vault_version)" = "$REQUIRED_VAULT_VERSION" ]
}

check_prerequisites() {
  if [ "$OS" = "darwin" ]; then
    if ! has_cmd curl; then
      echo "'curl' is required but not found in PATH." >&2
      exit 1
    fi
  else
    for cmd in curl sudo apt-get dpkg gpg; do
      if ! has_cmd "$cmd"; then
        echo "'${cmd}' is required but not found in PATH." >&2
        exit 1
      fi
    done
  fi
}

dir_has_files() {
  dir="$1"
  if [ ! -d "$dir" ]; then
    return 1
  fi
  [ -n "$(ls -A "$dir" 2>/dev/null)" ]
}

ensure_hashicorp_apt_repo() {
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://apt.releases.hashicorp.com/gpg | \
    sudo gpg --dearmor --yes -o /etc/apt/keyrings/hashicorp.gpg
  sudo chmod 644 /etc/apt/keyrings/hashicorp.gpg
  # shellcheck source=/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/hashicorp.gpg arch=$(dpkg --print-architecture)] https://apt.releases.hashicorp.com $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") main" | \
    sudo tee /etc/apt/sources.list.d/hashicorp.list >/dev/null
  sudo apt-get update -qq
}
