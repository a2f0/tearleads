#!/usr/bin/env bash
# Remove a tier's website domain before deleting its static assets.
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi
TIER="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/teardownGuard.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/teardownGuard.sh"
require_teardown_authorized "$TIER"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_cloudflare_env
export CLOUDFLARE_API_TOKEN="${TF_VAR_cloudflare_api_token:?}"
export CLOUDFLARE_ACCOUNT_ID="${TF_VAR_cloudflare_account_id:?}"
export WRANGLER_SEND_METRICS=false
"$REPO_ROOT/terraform/scripts/destroy-stack.sh" "$TIER" website
cd "$REPO_ROOT/packages/website"
bun run destroy:assets --env "$TIER" --force
