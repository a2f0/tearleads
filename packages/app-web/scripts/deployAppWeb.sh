#!/usr/bin/env bash
# Publish the Tearleads app-web and app-demo static bundles as Workers Static
# Assets for one tier. The tier's edge Terraform stack attaches the hostnames.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <prod|staging>" >&2
  exit 1
fi

TIER="$1"
case "$TIER" in
  prod | staging) ;;
  *)
    echo "ERROR: unknown app-web deploy tier: $TIER" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
APP_WEB_DIR="$REPO_ROOT/packages/app-web"

# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env "$TIER"
# shellcheck source=./sentryEnv.sh
# shellcheck disable=SC1091
. "$APP_WEB_DIR/scripts/sentryEnv.sh"
configure_sentry_env "$TIER"
validate_domain_env
validate_stripe_env "$TIER"
export_wrangler_env

DOMAIN="${TF_VAR_domain:?}"
API_HOSTNAME="$(tier_api_hostname "$TIER")"
APP_HOSTNAME="$(tier_app_hostname "$TIER")"
DEMO_HOSTNAME="$(tier_demo_hostname "$TIER")"

build_app_web() {
  local variant="$1"
  local label="$2"

  echo "Building $label..."
  (cd "$APP_WEB_DIR" && unset SENTRY_AUTH_TOKEN && \
    NODE_ENV=production \
    BUN_PUBLIC_APP_VARIANT="$variant" \
    BUN_PUBLIC_API_BASE_URL="https://${API_HOSTNAME}" \
    BUN_PUBLIC_WS_URL="wss://${API_HOSTNAME}/events" \
    BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY="${BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" \
    BUN_PUBLIC_SENTRY_DSN="${BUN_PUBLIC_SENTRY_DSN:-}" \
    BUN_PUBLIC_SENTRY_ENVIRONMENT="${BUN_PUBLIC_SENTRY_ENVIRONMENT:-}" \
    BUN_PUBLIC_SENTRY_COMMIT="${BUN_PUBLIC_SENTRY_COMMIT:-}" \
    bun run build)
  upload_sentry_source_maps "$APP_WEB_DIR" "$variant"
}

# Stage one build for Wrangler. Builds recreate dist/, so each variant is
# copied aside before the next build. Source maps stay out of the upload, and
# the header file reproduces the previous nginx cache policy: the entry
# document and the runtime workers revalidate on every load, while hashed
# chunks are immutable.
stage_assets() {
  local variant="$1"
  local assets_dir="$APP_WEB_DIR/dist-$variant"

  rm -rf "$assets_dir"
  cp -R "$APP_WEB_DIR/dist" "$assets_dir"
  printf '*.map\n' >"$assets_dir/.assetsignore"
  cat >"$assets_dir/_headers" <<'HEADERS'
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/worker.js
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/sqlite3.wasm
  Cache-Control: no-cache
/pdfjs/*
  Cache-Control: no-cache
/chunk-*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
}

publish_assets() {
  local variant="$1"
  local label="$2"

  echo "Publishing $label to Cloudflare..."
  (cd "$APP_WEB_DIR" && bun run "deploy:$variant" --env "$TIER")
}

build_app_web "app" "app-web"
stage_assets "app"
build_app_web "demo" "app-demo"
stage_assets "demo"

publish_assets "app" "app-web"
publish_assets "demo" "app-demo"

echo "App-web and app-demo deployed ($TIER)."

purge_cloudflare_cache_for_hosts "$DOMAIN" "$APP_HOSTNAME" "$DEMO_HOSTNAME"
