#!/usr/bin/env bash
# Delete a tier's API Worker and its Durable Objects after the edge stack has
# detached its hostname. Complete teardown only: `wrangler delete` also removes
# a custom domain still attached to the Worker, with its DNS record. A
# greenfield reset uses deployApiMaintenance.sh instead.
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
export_wrangler_env
cd "$REPO_ROOT/packages/api"
bunx --no-install wrangler delete --env "$TIER" --force
