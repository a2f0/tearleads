#!/usr/bin/env bash
# Deploy the Tearleads app-web and app-demo static bundles to production.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deployAppWeb.sh" prod
