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

  [[ -z "${TF_VAR_HCLOUD_TOKEN:-}" ]] && missing+=("TF_VAR_HCLOUD_TOKEN")
  [[ -z "${TF_VAR_SSH_KEY_NAME:-}" ]] && missing+=("TF_VAR_SSH_KEY_NAME")
  [[ -z "${TF_VAR_SERVER_USERNAME:-}" ]] && missing+=("TF_VAR_SERVER_USERNAME")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate staging domain
validate_staging_domain_env() {
  local missing=()

  [[ -z "${TF_VAR_STAGING_DOMAIN:-}" ]] && missing+=("TF_VAR_STAGING_DOMAIN")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Validate production domain
validate_production_domain_env() {
  local missing=()

  [[ -z "${TF_VAR_PRODUCTION_DOMAIN:-}" ]] && missing+=("TF_VAR_PRODUCTION_DOMAIN")

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

  [[ -z "${TF_VAR_CLOUDFLARE_API_TOKEN:-}" ]] && missing+=("TF_VAR_CLOUDFLARE_API_TOKEN")
  [[ -z "${TF_VAR_CLOUDFLARE_ACCOUNT_ID:-}" ]] && missing+=("TF_VAR_CLOUDFLARE_ACCOUNT_ID")

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

  export TF_VAR_SSH_HOST_PRIVATE_KEY=$(cat "$key_file")
  export TF_VAR_SSH_HOST_PUBLIC_KEY=$(cat "$key_file.pub")
}
