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

# Source a single env file with export semantics when it exists.
_source_optional_env_file() {
  local env_file="$1"

  if [[ ! -e "$env_file" ]]; then
    return 0
  fi

  _source_env_file "$env_file"
}

# Load secrets from .secrets/{root,<tier>,<tier>.garage}.env files.
# Usage: load_secrets_env [staging|prod]
#   - Always sources .secrets/root.env (shared infra creds).
#   - When a tier is given, also sources .secrets/<tier>.env.
#   - When present, also sources .secrets/<tier>.garage.env.
load_secrets_env() {
  local tier="${1:-}"
  local secrets_dir
  secrets_dir="$(get_repo_root)/.secrets"

  _source_env_file "$secrets_dir/root.env"

  if [[ -n "$tier" ]]; then
    _source_env_file "$secrets_dir/${tier}.env"
    _source_optional_env_file "$secrets_dir/${tier}.garage.env"
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

# Resolve a Cloudflare zone id, echoing it on success and nothing on failure.
# Callers treat an empty result as "skip the purge" — cache invalidation is
# best-effort and must never fail a deploy.
_resolve_cloudflare_zone_id() {
  local domain="$1"

  curl -sS -X GET "https://api.cloudflare.com/client/v4/zones?name=${domain}&account.id=${TF_VAR_cloudflare_account_id}" \
    -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
    -H "Content-Type: application/json" |
    jq -r '.result[0].id // empty'
}

# Best-effort Cloudflare cache purge for an explicit list of absolute URLs.
# Usage:
#   purge_cloudflare_cache_for_urls <zone-domain> <url1> [url2 ...]
#
# Cloudflare caps single-file purges at 30 URLs per request outside Enterprise,
# so the list is sent in batches of 30. A failing batch is reported but does not
# abort the remaining batches or the deploy.
purge_cloudflare_cache_for_urls() {
  local domain="$1"
  shift
  local urls=("$@")
  local zone_id
  local batch=()
  local url

  if [[ -z "$domain" ]]; then
    echo "Skipping Cloudflare cache purge: zone domain is not set."
    return 0
  fi

  if [[ ${#urls[@]} -eq 0 ]]; then
    echo "Skipping Cloudflare cache purge: no URLs were provided."
    return 0
  fi

  if [[ -z "${TF_VAR_cloudflare_api_token:-}" || -z "${TF_VAR_cloudflare_account_id:-}" ]]; then
    echo "Skipping Cloudflare cache purge: Cloudflare credentials are missing."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    echo "Skipping Cloudflare cache purge: curl and jq are required."
    return 0
  fi

  echo "Resolving Cloudflare zone for $domain..."
  zone_id="$(_resolve_cloudflare_zone_id "$domain")"

  if [[ -z "$zone_id" ]]; then
    echo "Skipping Cloudflare cache purge: could not resolve zone id for $domain."
    return 0
  fi

  echo "Purging Cloudflare cache for ${#urls[@]} URL(s) in $domain..."
  for url in "${urls[@]}"; do
    batch+=("$url")
    if [[ ${#batch[@]} -lt 30 ]]; then
      continue
    fi
    _purge_cloudflare_batch "$zone_id" "${batch[@]}"
    batch=()
  done

  if [[ ${#batch[@]} -gt 0 ]]; then
    _purge_cloudflare_batch "$zone_id" "${batch[@]}"
  fi
}

_purge_cloudflare_batch() {
  local zone_id="$1"
  shift
  local payload response

  payload="$(printf '%s\n' "$@" | jq -R . | jq -cs '{files: .}')"
  response="$(
    curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
      -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
      -H "Content-Type: application/json" \
      --data "$payload"
  )"

  if jq -e '.success == true' <<< "$response" >/dev/null; then
    echo "  Purged $# URL(s)."
  else
    echo "  Cloudflare cache purge failed for $# URL(s) (continuing):"
    jq -c . <<< "$response"
  fi
}

# Best-effort Cloudflare cache purge for a set of hosts in the given zone domain.
# Covers the entry points whose contents change while their URLs stay stable.
# Usage:
#   purge_cloudflare_cache_for_hosts <zone-domain> <host1> [host2 ...]
# Example:
#   purge_cloudflare_cache_for_hosts "tearleads.com" "tearleads.com" "app.tearleads.com"
purge_cloudflare_cache_for_hosts() {
  local domain="$1"
  shift
  local hosts=("$@")
  local files=()
  local host

  if [[ ${#hosts[@]} -eq 0 ]]; then
    echo "Skipping Cloudflare cache purge: no hosts were provided."
    return 0
  fi

  for host in "${hosts[@]}"; do
    files+=(
      "https://${host}/"
      "https://${host}/index.html"
      "https://${host}/favicon.svg"
      "https://${host}/favicon.ico"
      "https://${host}/apple-touch-icon.png"
      "https://${host}/manifest.webmanifest"
    )
    if [[ "$host" == app.* || "$host" == demo.* ]]; then
      files+=(
        "https://${host}/sw.js"
        "https://${host}/registerSW.js"
      )
    fi
  done

  purge_cloudflare_cache_for_urls "$domain" "${files[@]}"
}

# Best-effort Cloudflare purge of the website's screenshot gallery.
# Usage:
#   purge_cloudflare_screenshot_gallery <zone-domain> <host> <dist-dir>
#
# The gallery is restaged on every build under stable, non content-hashed paths,
# so a changed capture reuses its old URL and the edge keeps serving the old
# bytes. URLs are enumerated from the built dist rather than hardcoded, so added
# or removed captures need no change here.
purge_cloudflare_screenshot_gallery() {
  local domain="$1"
  local host="$2"
  local dist_dir="${3%/}"
  local gallery_dir="$dist_dir/screenshot-gallery"
  local urls=()
  local file

  if [[ ! -d "$gallery_dir" ]]; then
    echo "Skipping screenshot gallery purge: $gallery_dir does not exist."
    return 0
  fi

  while IFS= read -r file; do
    urls+=("https://${host}${file#"$dist_dir"}")
  done < <(find "$gallery_dir" -type f | sort)

  if [[ ${#urls[@]} -eq 0 ]]; then
    echo "Skipping screenshot gallery purge: no gallery files were built."
    return 0
  fi

  purge_cloudflare_cache_for_urls "$domain" "${urls[@]}"
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

# Resolve a reachable SSH target from a Terraform stack.
# Prefer the public server IP because Tailscale MagicDNS can lag after a server
# replacement, but keep the Tailscale hostname as a fallback.
resolve_stack_ssh_target() {
  local stack_dir="$1"
  local username hostname server_ip ssh_target

  username="$(terraform -chdir="$stack_dir" output -raw server_username 2>/dev/null || true)"
  hostname="$(terraform -chdir="$stack_dir" output -raw ssh_hostname 2>/dev/null || true)"
  server_ip="$(terraform -chdir="$stack_dir" output -raw server_ip 2>/dev/null || true)"

  if [[ -z "$username" ]]; then
    echo "ERROR: Could not resolve server username from terraform outputs." >&2
    echo "       Run 'terraform apply' in $stack_dir first." >&2
    return 1
  fi

  if [[ -n "$server_ip" ]]; then
    ssh_target="$username@$server_ip"
    if wait_for_ssh_ready "$ssh_target" >&2; then
      echo "$ssh_target"
      return 0
    fi

    if [[ -n "$hostname" ]]; then
      echo "WARNING: $ssh_target is not reachable; falling back to $username@$hostname." >&2
    fi
  fi

  if [[ -z "$hostname" ]]; then
    echo "ERROR: Could not resolve ssh_hostname or server_ip from terraform outputs." >&2
    echo "       Run 'terraform apply' in $stack_dir first." >&2
    return 1
  fi

  ssh_target="$username@$hostname"
  wait_for_ssh_ready "$ssh_target" >&2 || return 1
  echo "$ssh_target"
}
