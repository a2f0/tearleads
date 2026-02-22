#!/bin/sh
# Bootstrap a freshly formatted developer workstation with Tailscale, Vault CLI,
# and Terraform. These are prerequisites for reaching Vault over the tailnet,
# fetching secrets into .secrets/, and then running Terraform/Ansible workflows.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FETCH_SECRETS="${REPO_ROOT}/terraform/stacks/prod/vault/scripts/fetch-secrets.sh"
VAULT_HOST="vault-prod"
REPO_VAULT_VERSION_FILE="${REPO_ROOT}/.vault-version"
REPO_TERRAFORM_VERSION_FILE="${REPO_ROOT}/.terraform-version"
DEFAULT_MIN_TERRAFORM_VERSION="1.6.0"
REQUIRED_TERRAFORM_VERSION=""
REQUIRED_VAULT_VERSION=""
export VAULT_ADDR="${VAULT_ADDR:-http://${VAULT_HOST}:8200}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

terraform_cmd_path() {
  command -v terraform 2>/dev/null || true
}

terraform_version() {
  terraform version 2>/dev/null | awk 'NR==1 { print $2 }' | sed 's/^v//'
}

vault_version() {
  vault version 2>/dev/null | sed -n 's/^Vault v\([0-9][0-9.]*\).*/\1/p'
}

version_gte() {
  version_a="$1"
  version_b="$2"

  a_major="$(printf '%s' "$version_a" | cut -d. -f1)"
  a_minor="$(printf '%s' "$version_a" | cut -d. -f2)"
  a_patch="$(printf '%s' "$version_a" | cut -d. -f3)"
  b_major="$(printf '%s' "$version_b" | cut -d. -f1)"
  b_minor="$(printf '%s' "$version_b" | cut -d. -f2)"
  b_patch="$(printf '%s' "$version_b" | cut -d. -f3)"

  [ -n "$a_patch" ] || a_patch="0"
  [ -n "$b_patch" ] || b_patch="0"

  case "$a_major:$a_minor:$a_patch:$b_major:$b_minor:$b_patch" in
    *[!0-9:]* | *::*)
      return 1
      ;;
  esac

  if [ "$a_major" -gt "$b_major" ]; then
    return 0
  fi
  if [ "$a_major" -lt "$b_major" ]; then
    return 1
  fi
  if [ "$a_minor" -gt "$b_minor" ]; then
    return 0
  fi
  if [ "$a_minor" -lt "$b_minor" ]; then
    return 1
  fi

  [ "$a_patch" -ge "$b_patch" ]
}

load_required_terraform_version() {
  REQUIRED_TERRAFORM_VERSION="$DEFAULT_MIN_TERRAFORM_VERSION"

  if [ ! -f "$REPO_TERRAFORM_VERSION_FILE" ]; then
    return
  fi

  configured_version="$(sed -n '1{s/[[:space:]]//g;p;q;}' "$REPO_TERRAFORM_VERSION_FILE")"
  configured_version="${configured_version#v}"

  if [ -z "$configured_version" ]; then
    return
  fi

  case "$configured_version" in
    *[!0-9.]* | .* | *..* | *.)
      echo "Invalid Terraform version in ${REPO_TERRAFORM_VERSION_FILE}: ${configured_version}" >&2
      exit 1
      ;;
  esac

  REQUIRED_TERRAFORM_VERSION="$configured_version"
}

terraform_meets_required_version() {
  version="$(terraform_version)"
  version_gte "$version" "$REQUIRED_TERRAFORM_VERSION"
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
    if ! has_cmd brew; then
      echo "Homebrew is required but not found in PATH." >&2
      echo "Install it from https://brew.sh" >&2
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

# ---------------------------------------------------------------------------
# Install functions (idempotent)
# ---------------------------------------------------------------------------

install_tailscale() {
  if has_cmd tailscale; then
    echo "Tailscale is already installed."
    return
  fi

  echo "Installing Tailscale..."
  if [ "$OS" = "darwin" ]; then
    brew install --cask tailscale
  else
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  echo "Tailscale installed."
}

install_vault() {
  if has_cmd vault && vault_matches_required_version; then
    echo "Vault CLI $(vault_version) is already installed."
    return
  fi

  if has_cmd vault; then
    echo "Vault CLI $(vault_version) is installed but required version is ${REQUIRED_VAULT_VERSION}."
    echo "Upgrading/downgrading Vault CLI..."
  else
    echo "Installing Vault CLI..."
  fi

  if [ "$OS" = "darwin" ]; then
    if brew list vault >/dev/null 2>&1; then
      brew upgrade vault
    else
      brew install vault
    fi
  else
    ensure_hashicorp_apt_repo
    vault_pkg_version="$(apt-cache madison vault | awk -v req="$REQUIRED_VAULT_VERSION" '$3 ~ ("^" req "-") { print $3; exit }')"
    if [ -z "$vault_pkg_version" ]; then
      echo "Required Vault version ${REQUIRED_VAULT_VERSION} is not available in apt repository." >&2
      echo "Available versions (top 10):" >&2
      apt-cache madison vault | awk '{ print $3 }' | head -n 10 >&2
      exit 1
    fi
    sudo apt-get install -y "vault=${vault_pkg_version}"
  fi

  if ! has_cmd vault || ! vault_matches_required_version; then
    resolved_version="$(vault_version)"
    echo "Vault installation failed: installed version ${resolved_version:-unknown} does not match required ${REQUIRED_VAULT_VERSION}." >&2
    if [ "$OS" = "darwin" ]; then
      echo "On macOS, Homebrew may not provide exact historical versions. Install the pinned version manually or update .vault-version." >&2
    fi
    exit 1
  fi

  echo "Vault CLI $(vault_version) installed."
}

install_terraform() {
  terraform_bin="$(terraform_cmd_path)"

  if has_cmd terraform && terraform_meets_required_version; then
    echo "Terraform $(terraform_version) is already installed (>= ${REQUIRED_TERRAFORM_VERSION})."
    return
  fi

  if has_cmd terraform; then
    echo "Terraform $(terraform_version) is installed at ${terraform_bin:-unknown path} but below required version >= ${REQUIRED_TERRAFORM_VERSION}."
    echo "Upgrading Terraform..."
  else
    echo "Installing Terraform..."
  fi

  case "$terraform_bin" in
    *"/.tfenv/"*)
      if ! has_cmd tfenv; then
        echo "Terraform is managed by tfenv at ${terraform_bin}, but tfenv is not available in PATH." >&2
        exit 1
      fi
      echo "Detected tfenv-managed Terraform. Installing/selecting ${REQUIRED_TERRAFORM_VERSION} via tfenv..."
      tfenv install "${REQUIRED_TERRAFORM_VERSION}"
      tfenv use "${REQUIRED_TERRAFORM_VERSION}"
      ;;
    *)
      if [ "$OS" = "darwin" ]; then
        if brew list terraform >/dev/null 2>&1; then
          brew upgrade terraform
        else
          brew install terraform
        fi
      else
        ensure_hashicorp_apt_repo
        sudo apt-get install -y terraform
      fi
      ;;
  esac

  if ! has_cmd terraform || ! terraform_meets_required_version; then
    # If apt/brew installed a newer terraform but PATH still resolves to a stale tfenv shim,
    # repair by pinning tfenv to the minimum required version.
    terraform_bin="$(terraform_cmd_path)"
    case "$terraform_bin" in
      *"/.tfenv/"*)
        if has_cmd tfenv; then
          echo "Terraform in PATH is still tfenv-managed and below required version; selecting ${REQUIRED_TERRAFORM_VERSION} via tfenv..."
          tfenv install "${REQUIRED_TERRAFORM_VERSION}"
          tfenv use "${REQUIRED_TERRAFORM_VERSION}"
        fi
        ;;
    esac
  fi

  if ! has_cmd terraform || ! terraform_meets_required_version; then
    resolved_bin="$(terraform_cmd_path)"
    resolved_version="$(terraform_version)"
    echo "Terraform installation failed: ${resolved_bin:-terraform not found} reports version ${resolved_version:-unknown}, which does not satisfy >= ${REQUIRED_TERRAFORM_VERSION}." >&2
    if [ -n "$resolved_bin" ]; then
      echo "All terraform binaries in PATH:" >&2
      which -a terraform >&2 || true
    fi
    exit 1
  fi

  echo "Terraform $(terraform_version) installed at $(terraform_cmd_path)."
}

# ---------------------------------------------------------------------------
# Post-install checks
# ---------------------------------------------------------------------------

prompt_tailscale_auth() {
  echo ""
  echo "--- Tailscale connectivity ---"

  # Check if tailscale is running and authenticated
  set +e
  tailscale status >/dev/null 2>&1
  ts_rc=$?
  set -e

  if [ $ts_rc -eq 0 ]; then
    echo "Tailscale is connected."
    return
  fi

  echo "Tailscale is installed but not connected."
  if [ "$OS" = "darwin" ]; then
    echo "  1. Open Tailscale:  open /Applications/Tailscale.app"
    echo "  2. Sign in via the menu-bar icon"
  else
    echo "  Run:  sudo tailscale up"
    echo "  Then authenticate in the browser when prompted."
  fi
}

try_fetch_secrets() {
  echo ""
  echo "--- Vault secrets fetch ---"

  # 1. Tailscale connected?
  set +e
  tailscale status >/dev/null 2>&1
  ts_rc=$?
  set -e
  if [ $ts_rc -ne 0 ]; then
    echo "Tailscale is not connected. Connect first, then re-run this script."
    return
  fi

  # 2. Vault host reachable?
  set +e
  tailscale ping --timeout 3s -c 1 "$VAULT_HOST" >/dev/null 2>&1
  ping_rc=$?
  set -e
  if [ $ping_rc -ne 0 ]; then
    echo "Cannot reach '${VAULT_HOST}' over Tailscale."
    echo "Vault may not be provisioned yet. Skipping secret fetch."
    return
  fi

  # 3. Vault token available?
  if [ -z "${VAULT_TOKEN:-}" ] && [ ! -f "${HOME}/.vault-token" ]; then
    echo "No Vault token found (VAULT_TOKEN env or ~/.vault-token)."
    echo "Authenticate with:  vault login"
    return
  fi

  # 4. Vault responding?
  set +e
  vault status >/dev/null 2>&1
  vault_rc=$?
  set -e
  if [ $vault_rc -ne 0 ]; then
    echo "Vault is not responding at ${VAULT_ADDR}."
    echo "Check that the Vault server is running and unsealed."
    return
  fi

  # 5. All checks passed — delegate to existing fetch script
  if [ ! -f "$FETCH_SECRETS" ]; then
    echo "fetch-secrets.sh not found at ${FETCH_SECRETS}."
    echo "Skipping secret fetch."
    return
  fi

  printf "Fetch secrets from Vault now? [y/N] "
  read -r answer
  case "$answer" in
    [Yy]*) "$FETCH_SECRETS" ;;
    *) echo "Skipped. Run manually later:  ${FETCH_SECRETS}" ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo "==> Bootstrapping developer workstation"
  echo ""

  detect_os
  load_required_vault_version
  load_required_terraform_version
  check_prerequisites
  install_tailscale
  install_vault
  install_terraform
  prompt_tailscale_auth
  try_fetch_secrets

  echo ""
  echo "==> Bootstrap complete!"
  echo ""
  echo "Next steps:"
  if ! tailscale status >/dev/null 2>&1; then
    echo "  1. Connect to Tailscale (see instructions above)"
    echo "  2. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  3. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  4. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, etc.)"
  elif ! dir_has_files "${REPO_ROOT}/.secrets"; then
    echo "  1. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  2. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  3. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, etc.)"
  else
    echo "  1. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  2. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, etc.)"
  fi
}

main
