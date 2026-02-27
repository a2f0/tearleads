#!/usr/bin/env sh
set -eu

prompt_tailscale_auth() {
  echo ""
  echo "--- Tailscale connectivity ---"

  if ! has_cmd tailscale; then
    if [ "$OS" = "darwin" ]; then
      echo "Tailscale CLI not found; cannot verify status from script."
      echo "If Tailscale.app shows connected, continuing is fine."
      return
    fi
    echo "Tailscale CLI not found."
    return
  fi

  set +e
  tailscale status >/dev/null 2>&1
  ts_rc=$?
  set -e

  if [ "$ts_rc" -eq 0 ]; then
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

  if has_cmd tailscale; then
    set +e
    tailscale status >/dev/null 2>&1
    ts_rc=$?
    set -e
    if [ "$ts_rc" -ne 0 ]; then
      echo "Tailscale CLI status check failed; continuing to direct Vault reachability check."
    fi
  else
    echo "Tailscale CLI unavailable; using direct Vault reachability check."
  fi

  set +e
  if has_cmd tailscale; then
    tailscale ping --timeout 3s -c 1 "$VAULT_HOST" >/dev/null 2>&1
    reach_rc=$?
  else
    curl -s --max-time 3 -o /dev/null "${VAULT_ADDR}/v1/sys/health"
    reach_rc=$?
  fi
  set -e

  if [ "$reach_rc" -ne 0 ]; then
    echo "Cannot reach Vault at ${VAULT_ADDR}."
    echo "Vault may not be provisioned yet. Skipping secret fetch."
    return
  fi

  if [ -z "${VAULT_TOKEN:-}" ] && [ ! -f "${HOME}/.vault-token" ]; then
    echo "No Vault token found (VAULT_TOKEN env or ~/.vault-token)."
    echo "Authenticate with:  vault login"
    return
  fi

  set +e
  vault status >/dev/null 2>&1
  vault_rc=$?
  set -e
  if [ "$vault_rc" -ne 0 ]; then
    echo "Vault is not responding at ${VAULT_ADDR}."
    echo "Check that the Vault server is running and unsealed."
    return
  fi

  if [ ! -f "$FETCH_SECRETS" ]; then
    echo "fetch-secrets.ts not found at ${FETCH_SECRETS}."
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

bootstrap_api_dev_env() {
  echo ""
  echo "--- API env bootstrap ---"
  if setup_api_dev_env; then
    echo "API env bootstrap complete."
  else
    echo "Warning: API env bootstrap failed; continuing." >&2
  fi
}

bootstrap_local_garage() {
  setup_garage_script="${REPO_ROOT}/scripts/garage/setupLocalGarage.sh"
  if [ ! -f "${setup_garage_script}" ]; then
    return
  fi

  echo ""
  echo "--- Local Garage S3 bootstrap ---"

  if ! has_cmd docker; then
    echo "Docker is not installed. Skipping local Garage bootstrap."
    echo "Install Docker and run manually: ${setup_garage_script}"
    return
  fi

  printf "Bootstrap local Garage S3 for VFS blobs now? [y/N] "
  read -r answer
  case "$answer" in
    [Yy]*)
      if sh "${setup_garage_script}"; then
        echo "Local Garage bootstrap complete."
      else
        echo "Warning: local Garage bootstrap failed; continuing." >&2
        echo "Run manually: ${setup_garage_script}" >&2
      fi
      ;;
    *)
      echo "Skipped. Run manually later: ${setup_garage_script}"
      ;;
  esac
}
