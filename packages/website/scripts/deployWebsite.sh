#!/usr/bin/env bash
# Publish one static website, then attach its independently managed domain.
set -euo pipefail

TIER="${1:-}"
case "$TIER" in staging | prod) shift ;; *) echo "Usage: $0 <staging|prod> [--skip-terraform] [--dry-run]" >&2; exit 1 ;; esac
SKIP_TERRAFORM=false
WRANGLER_ARGS=()
TERRAFORM_ARGS=(apply -auto-approve)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-terraform) SKIP_TERRAFORM=true ;;
    --dry-run) WRANGLER_ARGS=(--dry-run); TERRAFORM_ARGS=(plan) ;;
    *) echo "ERROR: Unsupported website deployment argument: $1" >&2; exit 1 ;;
  esac
  shift
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_cloudflare_env
validate_domain_env
if [[ "$SKIP_TERRAFORM" == false ]]; then validate_aws_env; fi

export CLOUDFLARE_API_TOKEN="${TF_VAR_cloudflare_api_token:?}"
export CLOUDFLARE_ACCOUNT_ID="${TF_VAR_cloudflare_account_id:?}"
export WRANGLER_SEND_METRICS=false
export CI=true
if [[ "$TIER" == staging ]]; then
  export PUBLIC_ENVIRONMENT=staging
  export PUBLIC_STRIPE_CUSTOMER_PORTAL_URL="https://billing.stripe.com/p/login/test_00w7sKaemgcfdhb5lR0x200"
else
  export PUBLIC_ENVIRONMENT=production
fi

cd "$REPO_ROOT/packages/website"
bun run build
bun run deploy:assets --env "$TIER" "${WRANGLER_ARGS[@]+"${WRANGLER_ARGS[@]}"}"
if [[ "$SKIP_TERRAFORM" == false ]]; then
  "$REPO_ROOT/terraform/scripts/run-website-stack.sh" "$TIER" "${TERRAFORM_ARGS[@]}"
fi
echo "Website deployment command completed ($TIER)."
