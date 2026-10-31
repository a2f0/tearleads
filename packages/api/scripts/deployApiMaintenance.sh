#!/usr/bin/env bash
# Stop a tier's API writers for a greenfield reset without changing its
# hostname.
#
# Publishes packages/api/wrangler.maintenance.jsonc under the tier's API Worker
# name. In one deploy, every request starts answering 503 with Retry-After, the
# Cron Triggers are removed, and the `exports` tombstones delete the
# KeyValueStore and RealtimeHub Durable Object namespaces with all their
# storage. The custom domain stays attached to the Worker name, so DNS never
# changes; deployApi.sh later republishes the API and recreates both namespaces
# empty. Once the hostname serves the maintenance response, it waits out the
# invocations the old version started before returning. Rerunning it is
# harmless: an already deleted class is a stale tombstone.
#
# Unlike `wrangler delete`, which also removes the Worker's custom domain and
# its DNS record, nothing here detaches a hostname.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi
TIER="$1"
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/teardownGuard.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/teardownGuard.sh"
require_teardown_authorized "$TIER"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env "$TIER"
validate_domain_env
export_wrangler_env

cd "$REPO_ROOT/packages/api"
bunx --no-install wrangler deploy --config wrangler.maintenance.jsonc --env "$TIER"

API_URL="https://$(tier_api_hostname "$TIER")/"
echo "Waiting for $API_URL to answer with the maintenance response..."
serving=false
for _ in $(seq 1 30); do
  if curl -sS --max-time 10 -o /dev/null -D - "$API_URL" 2>/dev/null |
    tr -d '\r' | grep -qix 'x-tearleads-maintenance: reset'; then
    serving=true
    break
  fi
  sleep 2
done
if [[ "$serving" != true ]]; then
  echo "ERROR: $API_URL did not answer with the maintenance response." >&2
  exit 1
fi

# The old version keeps running invocations that started before the deploy. A
# Cron invocation may last 15 minutes and `waitUntil` work 30 seconds past its
# response, so wait out both before any data phase. HTTP requests have no
# duration limit; the data phases fence any that outlive this wait (see
# docs/developer/greenfield-reset.md).
DRAIN_SECONDS=930
echo "Maintenance is serving; draining old invocations for ${DRAIN_SECONDS}s..."
sleep "$DRAIN_SECONDS"
echo "API maintenance is live ($TIER); its hostname is unchanged."
