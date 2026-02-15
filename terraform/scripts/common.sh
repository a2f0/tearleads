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
