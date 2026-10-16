#!/bin/bash
# Common functions for Terraform stack scripts

# Get the repository root directory
get_repo_root() {
  git rev-parse --show-toplevel
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

# Every stack keeps its state in the Cloudflare R2 bucket
# tearleads-terraform-state. The tier's app.env holds that bucket's R2 key.
validate_tf_state_env() {
  local missing=()

  # A traced run would otherwise print the secret key in the test's expansion.
  local xtrace_was_enabled=0
  if [[ "$-" == *x* ]]; then
    xtrace_was_enabled=1
    set +x
  fi
  [[ -z "${TF_STATE_ACCESS_KEY_ID:-}" ]] && missing+=("TF_STATE_ACCESS_KEY_ID")
  [[ -z "${TF_STATE_SECRET_ACCESS_KEY:-}" ]] && missing+=("TF_STATE_SECRET_ACCESS_KEY")
  if [[ "$xtrace_was_enabled" -eq 1 ]]; then
    set -x
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing the R2 state backend key; set it in .secrets/<tier>/app.env:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Hand the R2 state key to Terraform as the AWS credentials the S3 backend
# reads. Only the stack wrappers call this, and they run nothing but Terraform
# afterwards. No stack configures the AWS provider, so the key reaches only the
# backend; a stack that adds one must not share this environment. Clearing the
# profile and session variables keeps an ambient AWS login from replacing or
# corrupting the key.
export_tf_state_env() {
  local xtrace_was_enabled=0
  if [[ "$-" == *x* ]]; then
    xtrace_was_enabled=1
    set +x
  fi
  if ! validate_tf_state_env; then
    if [[ "$xtrace_was_enabled" -eq 1 ]]; then
      set -x
    fi
    return 1
  fi
  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
  export AWS_ACCESS_KEY_ID="$TF_STATE_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$TF_STATE_SECRET_ACCESS_KEY"
  if [[ "$xtrace_was_enabled" -eq 1 ]]; then
    set -x
  fi
}

# Validate required environment variables for Cloudflare stacks
validate_cloudflare_env() {
  local missing=()

  # A traced run would otherwise print the token in the test's expansion.
  local xtrace_was_enabled=0
  if [[ "$-" == *x* ]]; then
    xtrace_was_enabled=1
    set +x
  fi
  [[ -z "${TF_VAR_cloudflare_api_token:-}" ]] && missing+=("TF_VAR_cloudflare_api_token")
  [[ -z "${TF_VAR_cloudflare_account_id:-}" ]] && missing+=("TF_VAR_cloudflare_account_id")
  if [[ "$xtrace_was_enabled" -eq 1 ]]; then
    set -x
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: Missing required environment variables:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    return 1
  fi
}

# Export the Cloudflare credentials Wrangler reads, from the Terraform ones.
export_wrangler_env() {
  local xtrace_was_enabled=0
  # Neither the validation's expansions nor the token assignment may appear
  # in a traced run.
  if [[ "$-" == *x* ]]; then
    xtrace_was_enabled=1
    set +x
  fi
  if ! validate_cloudflare_env; then
    if [[ "$xtrace_was_enabled" -eq 1 ]]; then
      set -x
    fi
    return 1
  fi
  export CLOUDFLARE_API_TOKEN="${TF_VAR_cloudflare_api_token:?}"
  export CLOUDFLARE_ACCOUNT_ID="${TF_VAR_cloudflare_account_id:?}"
  export WRANGLER_SEND_METRICS=false
  export CI=true
  if [[ "$xtrace_was_enabled" -eq 1 ]]; then
    set -x
  fi
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
