#!/usr/bin/env bash
# Delete the staging app and demo asset Workers after the edge stack has
# detached their hostnames.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env staging
export_wrangler_env
cd "$REPO_ROOT/packages/app-web"
for variant in app demo; do
  bun run "destroy:$variant" --env staging --force
done
