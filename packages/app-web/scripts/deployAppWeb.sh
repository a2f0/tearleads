#!/usr/bin/env bash
# Deploy the Tearleads app-web and app-demo static bundles to a server environment.

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
validate_stripe_env "$TIER"

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
    DEMO_HOST_PREFIX="demo."
    ;;
  staging)
    API_HOSTNAME="api-staging.${DOMAIN}"
    APP_HOSTNAME="app-staging.${DOMAIN}"
    DEMO_HOST_PREFIX="demo-staging."
    ;;
esac
DEMO_HOSTNAME="${DEMO_HOST_PREFIX}${DOMAIN}"

# The demo also answers on other Cloudflare zones. Read the same zone list that
# publishes their DNS records (TF_VAR_extra_demo_domains, which the server
# playbook reads too) so a purge cannot miss a host that is being routed here,
# and so each purge names the zone that actually owns its host.
extra_demo_zones=()
if [ -n "${TF_VAR_extra_demo_domains:-}" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required to read TF_VAR_extra_demo_domains." >&2
    exit 1
  fi
  if ! extra_demo_zone_list="$(printf '%s' "$TF_VAR_extra_demo_domains" |
    jq -r 'if type == "array" then .[] else error("not an array") end')"; then
    echo "ERROR: TF_VAR_extra_demo_domains must be a JSON array of zone names." >&2
    exit 1
  fi
  while IFS= read -r zone; do
    [ -n "$zone" ] || continue
    case "$zone" in
      demo.* | demo-*)
        echo "ERROR: TF_VAR_extra_demo_domains takes bare zone names; got $zone." >&2
        exit 1
        ;;
    esac
    if ! [[ "$zone" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
      echo "ERROR: TF_VAR_extra_demo_domains entry is not a zone name: $zone." >&2
      exit 1
    fi
    extra_demo_zones+=("$zone")
  done <<< "$extra_demo_zone_list"
fi

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

# `bun run build` clears dist/, so the demo build must follow the app bundle's
# rsync: it leaves dist/ holding the demo bundle, not the app one.
build_app_web "demo" "app-demo"
deploy_app_web_dist "app-demo" "/var/www/app-demo"

ssh "$SSH_TARGET" sudo systemctl reload nginx

echo "App-web and app-demo deployed."

purge_cloudflare_cache_for_hosts "$DOMAIN" "$APP_HOSTNAME" "$DEMO_HOSTNAME"
for zone in ${extra_demo_zones[@]+"${extra_demo_zones[@]}"}; do
  purge_cloudflare_cache_for_hosts "$zone" "${DEMO_HOST_PREFIX}${zone}"
done
