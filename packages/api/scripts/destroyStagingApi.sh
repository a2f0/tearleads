#!/usr/bin/env bash
# Delete the staging API Worker and its Durable Objects after the edge stack
# has detached its hostname.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env staging
export_wrangler_env
cd "$REPO_ROOT/packages/api"
bunx --no-install wrangler delete --env staging --force
