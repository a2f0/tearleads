#!/bin/bash
# Common functions for Terraform stack scripts

# Get the repository root directory
get_repo_root() {
  git rev-parse --show-toplevel
}

# Get the backend config file path
get_backend_config() {
  local repo_root
  repo_root="$(get_repo_root)"
  echo "$repo_root/terraform/configs/backend.hcl"
}

# Source a single env file with export semantics.
_source_env_file() {
  local env_file="$1"

  if [[ ! -f "$env_file" ]]; then
    if [[ -e "$env_file" ]]; then
      echo "ERROR: $env_file exists but is not a regular file." >&2
      return 1
    fi
    echo "WARNING: $env_file not found. Environment variables must be set manually." >&2
    return 0
  fi

  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
}

# Load secrets from .secrets/{root,<tier>}.env files.
# Usage: load_secrets_env [staging|prod]
#   - Always sources .secrets/root.env (shared infra creds).
#   - When a tier is given, also sources .secrets/<tier>.env.
load_secrets_env() {
  local tier="${1:-}"
  local secrets_dir
  secrets_dir="$(get_repo_root)/.secrets"

  _source_env_file "$secrets_dir/root.env"

  if [[ -n "$tier" ]]; then
    _source_env_file "$secrets_dir/${tier}.env"
  fi
}

# Validate required environment variables for Hetzner stacks (base)
validate_hetzner_env() {
  setup_ssh_host_keys
  local missing=()

  [[ -z "${TF_VAR_hcloud_token:-}" ]] && missing+=("TF_VAR_hcloud_token")
  [[ -z "${TF_VAR_ssh_key_name:-}" ]] && missing+=("TF_VAR_ssh_key_name")
  [[ -z "${TF_VAR_server_username:-}" ]] && missing+=("TF_VAR_server_username")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate staging domain
validate_staging_domain_env() {
  local missing=()

  [[ -z "${TF_VAR_staging_domain:-}" ]] && missing+=("TF_VAR_staging_domain")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate production domain
validate_production_domain_env() {
  local missing=()

  [[ -z "${TF_VAR_production_domain:-}" ]] && missing+=("TF_VAR_production_domain")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate required environment variables for Azure stacks
validate_azure_env() {
  local missing=()

  [[ -z "${ARM_SUBSCRIPTION_ID:-}" ]] && missing+=("ARM_SUBSCRIPTION_ID")
  [[ -z "${ARM_TENANT_ID:-}" ]] && missing+=("ARM_TENANT_ID")
  [[ -z "${ARM_CLIENT_ID:-}" ]] && missing+=("ARM_CLIENT_ID")
  [[ -z "${ARM_CLIENT_SECRET:-}" ]] && missing+=("ARM_CLIENT_SECRET")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate AWS credentials for S3 backend
validate_aws_env() {
  local missing=()

  [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] && missing+=("AWS_ACCESS_KEY_ID")
  [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]] && missing+=("AWS_SECRET_ACCESS_KEY")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables for S3 backend:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate required environment variables for Cloudflare stacks
validate_cloudflare_env() {
  local missing=()

  [[ -z "${TF_VAR_cloudflare_api_token:-}" ]] && missing+=("TF_VAR_cloudflare_api_token")
  [[ -z "${TF_VAR_cloudflare_account_id:-}" ]] && missing+=("TF_VAR_cloudflare_account_id")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate required environment variables for Tailscale stacks
validate_tailscale_env() {
  local missing=()

  [[ -z "${TF_VAR_tailscale_tailnet_id:-}" ]] && missing+=("TF_VAR_tailscale_tailnet_id")
  [[ -z "${TF_VAR_tailscale_api_token:-}" ]] && missing+=("TF_VAR_tailscale_api_token")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate Tailscale auth key for server registration
validate_tailscale_auth_key_env() {
  local missing=()

  [[ -z "${TF_VAR_tailscale_auth_key:-}" ]] && missing+=("TF_VAR_tailscale_auth_key")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Setup SSH host keys for persistent identity
setup_ssh_host_keys() {
  local secrets_dir="$(get_repo_root)/.secrets"
  local key_file="$secrets_dir/persistent_ssh_host_ed25519_key"

  mkdir -p "$secrets_dir"
  if [[ ! -f "$key_file" ]]; then
    ssh-keygen -t ed25519 -f "$key_file" -N "" -C "persistent_ssh_host_ed25519_key" > /dev/null
  fi

  export TF_VAR_ssh_host_private_key="$(cat "$key_file")"
  export TF_VAR_ssh_host_public_key="$(cat "$key_file.pub")"
}

# Ensure known_hosts has the persistent ed25519 host key for a host.
# This avoids stale host key conflicts after server recreation.
sync_known_host_key() {
  local host="$1"
  local secrets_dir
  local key_file
  local key_material
  local known_hosts_file

  secrets_dir="$(get_repo_root)/.secrets"
  key_file="$secrets_dir/persistent_ssh_host_ed25519_key.pub"
  known_hosts_file="$HOME/.ssh/known_hosts"

  if [[ ! -f "$key_file" ]]; then
    return 0
  fi

  key_material="$(awk '{print $1 " " $2}' "$key_file")"
  if [[ -z "$key_material" ]]; then
    echo "ERROR: Could not parse SSH public key from $key_file" >&2
    return 1
  fi

  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  touch "$known_hosts_file"
  chmod 600 "$known_hosts_file"

  ssh-keygen -R "$host" -f "$known_hosts_file" >/dev/null 2>&1 || true
  if ! grep -Fq "$host $key_material" "$known_hosts_file"; then
    echo "$host $key_material" >> "$known_hosts_file"
  fi
}

# Wait until SSH is reachable on a host, with retries and surfaced failure output.
wait_for_ssh_ready() {
  local ssh_target="$1"
  local ssh_retries="${2:-30}"
  local ssh_retry_delay_seconds="${3:-10}"
  local ssh_connect_timeout_seconds="${4:-10}"
  local ssh_host="${ssh_target#*@}"

  sync_known_host_key "$ssh_host"

  local attempt=1
  local ssh_output=""
  while (( attempt <= ssh_retries )); do
    ssh_output=""
    if ssh_output="$(ssh -o BatchMode=yes -o ConnectTimeout="$ssh_connect_timeout_seconds" "$ssh_target" true 2>&1)"; then
      return 0
    fi

    echo "SSH not ready yet (attempt $attempt/$ssh_retries). Retrying in ${ssh_retry_delay_seconds}s..."
    if [[ -n "$ssh_output" ]]; then
      echo "$ssh_output"
    fi
    sleep "$ssh_retry_delay_seconds"
    ((attempt++))
  done

  echo "ERROR: Unable to connect to $ssh_target over SSH after $ssh_retries attempts."
  return 1
}
