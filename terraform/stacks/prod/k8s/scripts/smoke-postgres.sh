#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-prod-k8s}"

require_kubeconfig_and_kubectl() {
  if [[ ! -f "$KUBECONFIG_FILE" ]]; then
    echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE"
    echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry."
    exit 1
  fi

  export KUBECONFIG="$KUBECONFIG_FILE"

  if ! command -v kubectl >/dev/null 2>&1; then
    echo "ERROR: kubectl is required."
    exit 1
  fi
}

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; return 1; }

phase_api_to_rds_tcp() {
  echo ""
  echo "Phase 1: API pod TCP reachability to RDS"

  local api_pod
  api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$api_pod" ]]; then
    fail "no running API pod found (label app=api)"
    return 1
  fi

  # Read POSTGRES_HOST and POSTGRES_PORT from the pod's environment
  local node_output
  if node_output="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- node -e "
    const net = require('net');
    const host = process.env.POSTGRES_HOST;
    if (!host) { console.error('POSTGRES_HOST not set'); process.exit(1); }
    const port = parseInt(process.env.POSTGRES_PORT || '5432', 10);
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      console.error('timeout connecting to ' + host + ':' + port);
      process.exit(1);
    }, 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      console.log('connected to ' + host + ':' + port);
      process.exit(0);
    });
    socket.on('error', (err) => {
      console.error(err.message);
      clearTimeout(timeout);
      process.exit(1);
    });
  " 2>&1)"; then
    pass "API pod $api_pod reached RDS: ${node_output}"
    return 0
  fi

  fail "API pod $api_pod could not reach RDS. Output: ${node_output:-No output}"
}

phase_api_to_rds_query() {
  echo ""
  echo "Phase 2: API pod SQL query to RDS (migration status)"

  local api_pod
  api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$api_pod" ]]; then
    fail "no running API pod found (label app=api)"
    return 1
  fi

  local cli_output
  if cli_output="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- node apiCli.cjs migrate --status 2>&1)"; then
    local version
    version="$(echo "$cli_output" | sed -n 's/.*Current schema version: \([0-9][0-9]*\).*/\1/p')"
    if [[ -n "$version" && "$version" -gt 0 ]]; then
      pass "API pod $api_pod queried RDS (schema version: $version)"
      return 0
    fi
  fi

  fail "API pod $api_pod could not query RDS. Output: ${cli_output:-No output}"
}

require_kubeconfig_and_kubectl

echo "Postgres (RDS) smoke test for prod K8s deployment"
echo "  Namespace:  $NAMESPACE"
echo "  Kubeconfig: $KUBECONFIG"

failures=0

phase_api_to_rds_tcp   || failures=$((failures + 1))
phase_api_to_rds_query || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All Postgres smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
