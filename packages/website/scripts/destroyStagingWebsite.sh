#!/usr/bin/env bash
# Remove the staging domain before deleting its static assets.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
for argument in "$@"; do
  case "$argument" in -auto-approve | --auto-approve) ;; *) echo "Usage: $0 [--auto-approve]" >&2; exit 1 ;; esac
done
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env staging
validate_cloudflare_env
export CLOUDFLARE_API_TOKEN="${TF_VAR_cloudflare_api_token:?}"
export CLOUDFLARE_ACCOUNT_ID="${TF_VAR_cloudflare_account_id:?}"
export WRANGLER_SEND_METRICS=false
"$REPO_ROOT/terraform/scripts/run-website-stack.sh" staging destroy "$@"
cd "$REPO_ROOT/packages/website"
bun run destroy:assets --env staging --force
