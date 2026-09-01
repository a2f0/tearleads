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
unset COMMON_SCRIPT_DIR

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

# Validate explicit ownership of the zone-level website cache ruleset.
validate_website_cache_env() {
  local missing=()

  [[ -z "${TF_VAR_manage_website_cache:-}" ]] && missing+=("TF_VAR_manage_website_cache")
  [[ -z "${TF_VAR_website_cache_additional_hostnames:-}" ]] && missing+=("TF_VAR_website_cache_additional_hostnames")

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

  export TAILSCALE_API_TOKEN="${TAILSCALE_API_TOKEN:-$TF_VAR_tailscale_api_token}"
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

# Setup SSH host keys for persistent identity
setup_ssh_host_keys() {
  local secrets_dir
  secrets_dir="$(get_repo_root)/.secrets"
  local key_file="$secrets_dir/persistent_ssh_host_ed25519_key"

  mkdir -p "$secrets_dir"
  if [[ ! -f "$key_file" ]]; then
    ssh-keygen -t ed25519 -f "$key_file" -N "" -C "persistent_ssh_host_ed25519_key" > /dev/null
  fi

  TF_VAR_ssh_host_private_key="$(cat "$key_file")"
  export TF_VAR_ssh_host_private_key
  TF_VAR_ssh_host_public_key="$(cat "$key_file.pub")"
  export TF_VAR_ssh_host_public_key
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

    if (( attempt == ssh_retries )); then
      break
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

# Read the Tailscale-only SSH target from Terraform state without contacting it.
# Returns 2 when the stack has no server outputs yet.
read_stack_ssh_target() {
  local stack_dir="$1"
  local username_status=0
  local hostname_status=0
  local state_list_status=0
  local state_list_error
  local state_resources
  local username hostname

  username="$(terraform -chdir="$stack_dir" output -raw server_username 2>/dev/null)" || username_status=$?
  hostname="$(terraform -chdir="$stack_dir" output -raw ssh_hostname 2>/dev/null)" || hostname_status=$?

  if [[ "$username_status" -ne 0 && "$hostname_status" -ne 0 ]]; then
    state_list_error="$(mktemp "${TMPDIR:-/tmp}/tearleads-terraform-state.XXXXXX")" || return 1
    state_resources="$(terraform -chdir="$stack_dir" state list 2>"$state_list_error")" || state_list_status=$?
    if [[ "$state_list_status" -ne 0 ]]; then
      if grep -q "No state file was found" "$state_list_error"; then
        rm -f -- "$state_list_error"
        return 2
      fi
      cat "$state_list_error" >&2
      rm -f -- "$state_list_error"
      return 1
    fi
    rm -f -- "$state_list_error"
    if [[ -z "$state_resources" ]]; then
      return 2
    fi
    echo "ERROR: Terraform state exists but server SSH outputs are unavailable." >&2
    return 1
  fi

  if [[ "$username_status" -ne 0 || -z "$username" ]]; then
    echo "ERROR: Could not resolve server username from terraform outputs." >&2
    echo "       Run 'terraform apply' in $stack_dir first." >&2
    return 1
  fi

  if [[ "$hostname_status" -ne 0 || -z "$hostname" ]]; then
    echo "ERROR: Could not resolve the Tailscale ssh_hostname from terraform outputs." >&2
    echo "       Run 'terraform apply' in $stack_dir first." >&2
    return 1
  fi

  echo "$username@$hostname"
}

# Resolve the Tailscale-only SSH target from a Terraform stack.
resolve_stack_ssh_target() {
  local stack_dir="$1"
  local read_status=0
  local ssh_target

  ssh_target="$(read_stack_ssh_target "$stack_dir")" || read_status=$?
  if [[ "$read_status" -eq 2 ]]; then
    echo "ERROR: Could not resolve server SSH details from terraform outputs." >&2
    echo "       Run 'terraform apply' in $stack_dir first." >&2
    return 1
  fi
  if [[ "$read_status" -ne 0 ]]; then
    return "$read_status"
  fi

  wait_for_ssh_ready "$ssh_target" >&2 || return 1
  echo "$ssh_target"
}
