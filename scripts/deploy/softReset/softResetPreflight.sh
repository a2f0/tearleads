#!/usr/bin/env bash
# Preflight/build-only companion. Never deploys, migrates, or captures screenshots.
set -euo pipefail
set +x
TIER="${1:-}"
MODE="${2:-}"
case "$TIER:$MODE" in
  prod:credentials | staging:credentials | prod:api | staging:api | \
    prod:web | staging:web | prod:website | staging:website) ;;
  *) echo 'Usage: softResetPreflight.sh <prod|staging> <credentials|api|web|website>' >&2; exit 1 ;;
esac
REPO_ROOT="$(git -c core.fsmonitor=false rev-parse --show-toplevel)"
# shellcheck source=terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
_source_optional_env_file "$REPO_ROOT/.secrets/$TIER/planetscale.env"
validate_tf_state_env
validate_cloudflare_env
validate_domain_env
validate_stripe_env "$TIER"
export_wrangler_env
# shellcheck source=packages/api/scripts/sentryBuild.sh
source "$REPO_ROOT/packages/api/scripts/sentryBuild.sh"
configure_api_sentry "$TIER"
# shellcheck source=packages/app-web/scripts/sentryEnv.sh
source "$REPO_ROOT/packages/app-web/scripts/sentryEnv.sh"
configure_sentry_env "$TIER"
if [[ -z "${PLANETSCALE_SERVICE_TOKEN_ID:-}" || -z "${PLANETSCALE_SERVICE_TOKEN:-}" ||
  ${#DOCUMENT_SYNC_CURSOR_HMAC_KEY} -lt 32 || "${BLOB_GC_HEALTHCHECK_URL:-}" != https://* ]]; then
  echo 'Missing PlanetScale, existing cursor signing key, or healthcheck configuration.' >&2
  exit 1
fi
ORGANIZATION="${TF_VAR_planetscale_organization:-tearleads}"
if [[ ! "$TF_VAR_cloudflare_account_id" =~ ^[a-f0-9]{32}$ ||
  ! "$TF_VAR_domain" =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ||
  ! "$ORGANIZATION" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo 'Invalid account, domain, or organization configuration.' >&2
  exit 1
fi
API_PUBLIC_ORIGIN="https://$(tier_api_hostname "$TIER")"
export API_PUBLIC_ORIGIN
export API_BILLING_RETURN_ORIGINS="${API_BILLING_RETURN_ORIGINS:-https://$(tier_app_hostname "$TIER"),https://$(tier_demo_hostname "$TIER"),https://localhost,http://127.0.0.1:3002}"
case "$MODE" in
  credentials)
    for tool in git bash bun bunx terraform jq aws psql curl python3; do
      command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
    done
    (cd "$REPO_ROOT/packages/api" && bun -e '
      import { readBillingReturnOrigins } from "./src/billing/returnOrigins";
      readBillingReturnOrigins({ ...process.env, NODE_ENV: "production" });
    ') >&2
    printf '{"account":"%s","organization":"%s","domain":"%s"}\n' \
      "$TF_VAR_cloudflare_account_id" "$ORGANIZATION" "$TF_VAR_domain"
    ;;
  website)
    export PUBLIC_ENVIRONMENT=production
    if [[ "$TIER" == staging ]]; then
      export PUBLIC_ENVIRONMENT=staging
      export PUBLIC_STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/p/login/test_00w7sKaemgcfdhb5lR0x200
    fi
    # The normal prebuild validates existing shared screenshot provenance. It
    # fails on stale/incomplete/dirty captures; do not run a capture here.
    bun run --cwd "$REPO_ROOT/packages/website" build
    ;;
  web)
    export NODE_ENV=production APP_WEB_TIER="$TIER"
    export BUN_PUBLIC_API_BASE_URL="$API_PUBLIC_ORIGIN"
    BUN_PUBLIC_WS_URL="wss://$(tier_api_hostname "$TIER")/events"
    export BUN_PUBLIC_WS_URL
    unset SENTRY_AUTH_TOKEN
    for variant in app demo; do
      BUN_PUBLIC_APP_VARIANT="$variant" bun run --cwd "$REPO_ROOT/packages/app-web" build
    done
    ;;
  api)
    umask 077
    CONFIG="$(mktemp "$REPO_ROOT/packages/api/wrangler.deploy.XXXXXX")"
    mv "$CONFIG" "$CONFIG.jsonc"
    CONFIG="$CONFIG.jsonc"
    trap 'rm -f "$CONFIG"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
    HYPERDRIVE_ID="$("$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" "$TIER" output -raw hyperdrive_id)"
    [[ "$HYPERDRIVE_ID" =~ ^[a-f0-9]{32}$ ]] || { echo 'Invalid Hyperdrive ID.' >&2; exit 1; }
    sed "s/HYPERDRIVE_ID_$TIER/$HYPERDRIVE_ID/g" "$REPO_ROOT/packages/api/wrangler.jsonc" >"$CONFIG"
    cd "$REPO_ROOT/packages/api"
    DEFINES=()
    DEFINES_TEXT="$(bun scripts/workerDefines.ts)"
    while IFS= read -r define; do
      [[ -n "$define" ]] && DEFINES+=(--define "$define")
    done <<<"$DEFINES_TEXT"
    # Do not call build_api_worker here: that helper also uploads Sentry maps.
    bunx --no-install wrangler deploy --dry-run --outdir "$TMPDIR/api-readiness" \
      --env "$TIER" --config "$CONFIG" ${DEFINES[@]+"${DEFINES[@]}"}
    ;;
esac
