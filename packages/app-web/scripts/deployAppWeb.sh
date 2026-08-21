#!/usr/bin/env bash
# Deploy the SymCrypt app-web static bundles to a server environment.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <prod|staging>" >&2
  exit 1
fi

TIER="$1"
case "$TIER" in
  prod)
    STACK_RELATIVE_DIR="terraform/stacks/prod/server"
    ;;
  staging)
    STACK_RELATIVE_DIR="terraform/stacks/staging/server"
    ;;
  *)
    echo "ERROR: unknown app-web deploy tier: $TIER" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
APP_WEB_DIR="$REPO_ROOT/packages/app-web"

# shellcheck source=../../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env "$TIER"
validate_aws_env

if [ -z "${SSH_TARGET:-}" ]; then
  STACK_DIR="$REPO_ROOT/$STACK_RELATIVE_DIR"
  BACKEND_CONFIG="$(get_backend_config)"
  terraform -chdir="$STACK_DIR" init -backend-config="$BACKEND_CONFIG" >&2
  SSH_TARGET="$(resolve_stack_ssh_target "$STACK_DIR")"
fi
export SSH_TARGET

DOMAIN="${TF_VAR_domain:-}"

if [ -z "$DOMAIN" ]; then
  echo "ERROR: TF_VAR_domain is required to build app-web URLs." >&2
  exit 1
fi

case "$TIER" in
  prod)
    API_HOSTNAME="api.${DOMAIN}"
    APP_HOSTNAME="app.${DOMAIN}"
    ;;
  staging)
    API_HOSTNAME="api-staging.${DOMAIN}"
    APP_HOSTNAME="app-staging.${DOMAIN}"
    ;;
esac

build_app_web() {
  local variant="$1"
  local label="$2"

  echo "Building $label..."
  (cd "$APP_WEB_DIR" && \
    NODE_ENV=production \
    BUN_PUBLIC_APP_VARIANT="$variant" \
    BUN_PUBLIC_API_BASE_URL="https://${API_HOSTNAME}" \
    BUN_PUBLIC_WS_URL="wss://${API_HOSTNAME}/events" \
    BUN_PUBLIC_REVENUECAT_WEB_API_KEY="${BUN_PUBLIC_REVENUECAT_WEB_API_KEY:-}" \
    BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY="${BUN_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" \
    bun run build)
}

deploy_app_web_dist() {
  local label="$1"
  local remote_path="$2"

  echo "Deploying $label static files to $SSH_TARGET:$remote_path ..."
  ssh "$SSH_TARGET" sudo mkdir -p "$remote_path"
  rsync -avz --no-owner --no-group --delete --rsync-path="sudo rsync" \
    "$APP_WEB_DIR/dist/" "$SSH_TARGET:$remote_path/"
  ssh "$SSH_TARGET" sudo chown -R www-data:www-data "$remote_path"
  ssh "$SSH_TARGET" sudo chmod -R u=rwX,go=rX "$remote_path"
}

build_app_web "app" "app-web"
deploy_app_web_dist "app-web" "/var/www/app-web"

ssh "$SSH_TARGET" sudo systemctl reload nginx

echo "App-web deployed."

purge_cloudflare_cache_for_hosts "$DOMAIN" "$APP_HOSTNAME"
