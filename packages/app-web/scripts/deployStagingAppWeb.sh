#!/usr/bin/env bash
# Deploy the SymCrypt app-web static bundle to staging.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deployAppWeb.sh" staging
