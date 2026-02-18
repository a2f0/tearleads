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

# Setup SSH host keys for persistent identity
setup_ssh_host_keys() {
  local secrets_dir="$(get_repo_root)/.secrets"
  local key_file="$secrets_dir/persistent_ssh_host_ed25519_key"

  mkdir -p "$secrets_dir"
  if [[ ! -f "$key_file" ]]; then
    ssh-keygen -t ed25519 -f "$key_file" -N "" -C "persistent_ssh_host_ed25519_key" > /dev/null
  fi

  export TF_VAR_ssh_host_private_key=$(cat "$key_file")
  export TF_VAR_ssh_host_public_key=$(cat "$key_file.pub")
}

# Wait until SSH is reachable on a host, with retries and surfaced failure output.
wait_for_ssh_ready() {
  local ssh_target="$1"
  local ssh_retries="${2:-30}"
  local ssh_retry_delay_seconds="${3:-10}"
  local ssh_connect_timeout_seconds="${4:-10}"

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
