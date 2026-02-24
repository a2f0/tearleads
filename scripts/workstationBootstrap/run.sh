#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=/dev/null
. "${SCRIPT_DIR}/common.sh"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/installers.sh"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/postChecks.sh"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/api.sh"

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
  install_postgres_linux
  prompt_tailscale_auth
  try_fetch_secrets
  bootstrap_api_dev_env
  bootstrap_local_garage

  echo ""
  echo "==> Bootstrap complete!"
  echo ""
  echo "Next steps:"
  if has_cmd tailscale && ! tailscale status >/dev/null 2>&1; then
    echo "  1. Connect to Tailscale (see instructions above)"
    echo "  2. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  3. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  4. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, Codex, Gemini CLI, etc.)"
  elif ! has_cmd tailscale && [ "$OS" = "darwin" ]; then
    echo "  1. Confirm Tailscale.app is connected"
    echo "  2. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  3. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  4. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, Codex, Gemini CLI, etc.)"
  elif ! dir_has_files "${REPO_ROOT}/.secrets"; then
    echo "  1. Fetch secrets:  ${FETCH_SECRETS}"
    echo "  2. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  3. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, Codex, Gemini CLI, etc.)"
  else
    echo "  1. Run Ansible:    ansible-playbook ansible/playbooks/developerWorkstation.yml"
    echo "  2. Optional local S3: sh scripts/garage/setupLocalGarage.sh"
    echo "  3. Run tuxedo playbook (remote host): ansible-playbook ansible/playbooks/tuxedo.yml"
    echo "     (installs Neovim 0.10+, Node.js, ripgrep, fd, uv, Claude Code, Codex, Gemini CLI, etc.)"
  fi
}

main "$@"
