#!/bin/bash
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging
setup_ssh_host_keys

purge_cloudflare_cache() {
  local domain zone_id response
  local website_host app_host

  domain="${TF_VAR_domain:-}"

  if [[ -z "$domain" ]]; then
    echo "Skipping Cloudflare cache purge: TF_VAR_domain is not set."
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

  website_host="k8s.$domain"
  app_host="app.k8s.$domain"

  echo "Resolving Cloudflare zone for $domain..."
  zone_id="$(
    curl -sS -X GET "https://api.cloudflare.com/client/v4/zones?name=${domain}&account.id=${TF_VAR_cloudflare_account_id}" \
      -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
      -H "Content-Type: application/json" |
      jq -r '.result[0].id // empty'
  )"

  if [[ -z "$zone_id" ]]; then
    echo "Skipping Cloudflare cache purge: could not resolve zone id for $domain."
    return 0
  fi

  echo "Purging Cloudflare cache for $website_host and $app_host..."
  response="$(
    curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
      -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
      -H "Content-Type: application/json" \
      --data "$(jq -nc \
        --arg website "https://${website_host}" \
        --arg app "https://${app_host}" \
        '{files: [
          ($website + "/"),
          ($website + "/index.html"),
          ($website + "/favicon.svg"),
          ($website + "/manifest.webmanifest"),
          ($app + "/"),
          ($app + "/index.html"),
          ($app + "/favicon.svg"),
          ($app + "/manifest.webmanifest"),
          ($app + "/sw.js"),
          ($app + "/registerSW.js")
        ]}')"
  )"

  if [[ "$(echo "$response" | jq -r '.success')" == "true" ]]; then
    echo "Cloudflare cache purge request submitted successfully."
  else
    echo "Cloudflare cache purge failed (continuing):"
    echo "$response" | jq -c .
  fi
}

echo "WARNING: This will destroy the staging k8s cluster."
echo "All workloads and data on this cluster will be lost."
echo "Press Ctrl+C to cancel, or wait 5 seconds to continue..."
sleep 5

terraform -chdir="$STACK_DIR" destroy "$@"
purge_cloudflare_cache

echo "Removing STAGING_KUBECONFIG_B64 from GitHub Actions secrets..."
REPO="$(get_github_repo)"
if gh secret delete STAGING_KUBECONFIG_B64 -R "$REPO" 2>/dev/null; then
  echo "STAGING_KUBECONFIG_B64 secret removed."
else
  echo "STAGING_KUBECONFIG_B64 secret was not set (nothing to remove)."
fi

echo "Removing STAGING_K8S_SSH_HOST from GitHub Actions variables..."
if gh variable delete STAGING_K8S_SSH_HOST -R "$REPO" 2>/dev/null; then
  echo "STAGING_K8S_SSH_HOST variable removed."
else
  echo "STAGING_K8S_SSH_HOST variable was not set (nothing to remove)."
fi
