#!/usr/bin/env bash
# Deploy the production website directly to Cloudflare.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
exec "$REPO_ROOT/packages/website/scripts/deployWebsite.sh" prod "$@"
