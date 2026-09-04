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
    DEMO_HOSTNAME="demo.${DOMAIN}"
    ;;
  staging)
    API_HOSTNAME="api-staging.${DOMAIN}"
    APP_HOSTNAME="app-staging.${DOMAIN}"
    DEMO_HOSTNAME="demo-staging.${DOMAIN}"
    ;;
esac

# Every demo host serves the same bundle from /var/www/app-demo, so the deploy
# purges each of them. APP_DEMO_HOSTNAMES is the same comma-separated override
# the server playbook reads when demo hosts live in more than one zone.
read_demo_hosts() {
  local value="$1"
  local item

  IFS=',' read -r -a demo_hosts <<< "$value"
  for i in "${!demo_hosts[@]}"; do
    item="${demo_hosts[$i]}"
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    demo_hosts[i]="$item"
  done
}

demo_hosts=()
if [ -n "${APP_DEMO_HOSTNAMES:-}" ]; then
  read_demo_hosts "$APP_DEMO_HOSTNAMES"
else
  demo_hosts=("$DEMO_HOSTNAME")
fi

# A purge is scoped to the zone that owns the host: hosts under this tier's
# domain purge against it, and a `demo.<zone>` host in another zone names its
# own.
purge_demo_host() {
  local host="$1"

  if [ -z "$host" ]; then
    return 0
  fi
  if [[ "$host" == *".${DOMAIN}" ]]; then
    purge_cloudflare_cache_for_hosts "$DOMAIN" "$host"
  elif [[ "$host" == demo.* ]]; then
    purge_cloudflare_cache_for_hosts "${host#demo.}" "$host"
  else
    echo "Skipping Cloudflare cache purge for $host: cannot infer zone."
  fi
}

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

build_app_web "demo" "app-demo"
deploy_app_web_dist "app-demo" "/var/www/app-demo"

ssh "$SSH_TARGET" sudo systemctl reload nginx

echo "App-web and app-demo deployed."

purge_cloudflare_cache_for_hosts "$DOMAIN" "$APP_HOSTNAME"
for demo_host in "${demo_hosts[@]}"; do
  purge_demo_host "$demo_host"
done
