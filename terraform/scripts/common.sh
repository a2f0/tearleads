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

COMMON_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=terraform/scripts/secretsEnv.sh
. "$COMMON_SCRIPT_DIR/secretsEnv.sh"
# shellcheck source=terraform/scripts/stripeEnv.sh
. "$COMMON_SCRIPT_DIR/stripeEnv.sh"
unset COMMON_SCRIPT_DIR

# Validate domain
validate_domain_env() {
  local missing=()

  [[ -z "${TF_VAR_domain:-}" ]] && missing+=("TF_VAR_domain")

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

validate_aws_env() {
  if [[ -n "${AWS_PROFILE:-}" || -n "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" || -n "${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:-}" ]]; then
    return 0
  fi

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

# Export the Cloudflare credentials Wrangler reads, from the Terraform ones.
export_wrangler_env() {
  validate_cloudflare_env || return 1
  export CLOUDFLARE_API_TOKEN="${TF_VAR_cloudflare_api_token:?}"
  export CLOUDFLARE_ACCOUNT_ID="${TF_VAR_cloudflare_account_id:?}"
  export WRANGLER_SEND_METRICS=false
  export CI=true
}

# Cloudflare cache invalidation helpers live in a sibling file to keep this one
# within the source-shape budget. Resolved relative to this script so callers
# can source common.sh from any working directory.
#
# `BASH_SOURCE` is bash-only. Every script here runs under bash, but this file
# is also worth sourcing by hand from an interactive shell — and in zsh the
# unset array collapsed to `dirname ""` → the working directory, so the source
# failed and the purge helpers went silently missing. `$0` carries the sourced
# path in zsh, so the fallback covers both.
# shellcheck source=./cloudflareCache.sh
# shellcheck disable=SC1091
. "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/cloudflareCache.sh"

# Load VAULT_TOKEN from .secrets/vault-keys.json at runtime.
# Skips if VAULT_TOKEN is already set in the environment.
load_vault_token() {
  if [[ -n "${VAULT_TOKEN:-}" ]]; then
    return 0
  fi

  local vault_keys_file
  vault_keys_file="$(get_repo_root)/.secrets/vault-keys.json"

  if [[ -f "$vault_keys_file" ]]; then
    VAULT_TOKEN=$(jq -r '.root_token // empty' "$vault_keys_file")
    if [[ -z "$VAULT_TOKEN" ]]; then
      echo "ERROR: $vault_keys_file exists but has no root_token." >&2
      return 1
    fi
    export VAULT_TOKEN
  elif [[ -f ~/.vault-token ]]; then
    VAULT_TOKEN=$(cat ~/.vault-token)
    export VAULT_TOKEN
  else
    echo "WARNING: No VAULT_TOKEN, vault-keys.json, or ~/.vault-token found." >&2
  fi
}

# Get the GitHub owner/repo slug from the git remote origin URL.
get_github_repo() {
  git -C "$(get_repo_root)" remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||'
}

# Public hostnames for a deployment tier, from the configured domain.
tier_api_hostname() {
  case "$1" in
    staging) echo "api-staging.${TF_VAR_domain:?}" ;;
    prod) echo "api.${TF_VAR_domain:?}" ;;
    *) echo "ERROR: Unknown deployment tier: $1" >&2; return 1 ;;
  esac
}

tier_app_hostname() {
  case "$1" in
    staging) echo "app-staging.${TF_VAR_domain:?}" ;;
    prod) echo "app.${TF_VAR_domain:?}" ;;
    *) echo "ERROR: Unknown deployment tier: $1" >&2; return 1 ;;
  esac
}

tier_demo_hostname() {
  case "$1" in
    staging) echo "demo-staging.${TF_VAR_domain:?}" ;;
    prod) echo "demo.${TF_VAR_domain:?}" ;;
    *) echo "ERROR: Unknown deployment tier: $1" >&2; return 1 ;;
  esac
}
