#!/bin/sh
# Bootstrap a freshly formatted developer workstation with Tailscale and Vault CLI.
# These are prerequisites for reaching Vault over the tailnet, fetching secrets
# into .secrets/, and then running the Ansible developer workstation playbook.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FETCH_SECRETS="${REPO_ROOT}/terraform/stacks/prod/vault/scripts/fetch-secrets.sh"
VAULT_HOST="vault-prod"
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

check_prerequisites() {
  if [ "$OS" = "darwin" ]; then
    if ! has_cmd brew; then
      echo "Homebrew is required but not found in PATH." >&2
      echo "Install it from https://brew.sh" >&2
      exit 1
    fi
  else
    for cmd in curl sudo; do
      if ! has_cmd "$cmd"; then
        echo "'${cmd}' is required but not found in PATH." >&2
        exit 1
      fi
    done
  fi
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
  if has_cmd vault; then
    echo "Vault CLI is already installed."
    return
  fi

  echo "Installing Vault CLI..."
  if [ "$OS" = "darwin" ]; then
    brew install vault
  else
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://apt.releases.hashicorp.com/gpg | \
      sudo gpg --dearmor --yes -o /etc/apt/keyrings/hashicorp.gpg
    sudo chmod 644 /etc/apt/keyrings/hashicorp.gpg
    # shellcheck source=/dev/null
    echo "deb [signed-by=/etc/apt/keyrings/hashicorp.gpg arch=$(dpkg --print-architecture)] https://apt.releases.hashicorp.com $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") main" | \
      sudo tee /etc/apt/sources.list.d/hashicorp.list >/dev/null
    sudo apt-get update -qq
    sudo apt-get install -y vault
  fi
  echo "Vault CLI installed."
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
  check_prerequisites
  install_tailscale
  install_vault
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
  elif [ ! -d "${REPO_ROOT}/.secrets" ] || [ -z "$(ls -A "${REPO_ROOT}/.secrets" 2>/dev/null)" ]; then
    echo "  1. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  2. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
  else
    echo "  1. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
  fi
}

main
