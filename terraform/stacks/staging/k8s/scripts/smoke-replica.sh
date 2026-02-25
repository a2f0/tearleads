#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env staging

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"

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

phase_replica_query() {
  echo ""
  echo "Phase 1: Replica pod query (SELECT 1)"

  local replica_pod
  replica_pod="$(kubectl -n "$NAMESPACE" get pods -l app=postgres-replica --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$replica_pod" ]]; then
    fail "no running replica pod found (label app=postgres-replica)"
    return 1
  fi

  local psql_output
  if psql_output="$(kubectl -n "$NAMESPACE" exec "$replica_pod" -c postgres -- sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1" | grep -qx 1' 2>&1)"; then
    pass "Replica pod $replica_pod accepted query SELECT 1"
    return 0
  fi

  fail "Replica pod $replica_pod did not return SELECT 1. Output: ${psql_output:-No output}"
}

phase_replication_status() {
  echo ""
  echo "Phase 2: Replication status on primary"

  local postgres_pod
  postgres_pod="$(kubectl -n "$NAMESPACE" get pods -l app=postgres --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$postgres_pod" ]]; then
    fail "no running primary Postgres pod found (label app=postgres)"
    return 1
  fi

  local repl_output
  repl_output="$(kubectl -n "$NAMESPACE" exec "$postgres_pod" -c postgres -- sh -lc 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT client_addr, state, sent_lsn, replay_lsn FROM pg_stat_replication"' 2>&1)"

  if [[ -n "$repl_output" ]] && echo "$repl_output" | grep -q "streaming"; then
    pass "Primary reports streaming replication active"
    echo "        $repl_output"
    return 0
  fi

  fail "No active streaming replication found on primary. Output: ${repl_output:-No output}"
}

phase_api_to_replica_tcp() {
  echo ""
  echo "Phase 3: API pod TCP reachability to postgres-replica service"

  local api_pod
  api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$api_pod" ]]; then
    fail "no running API pod found (label app=api)"
    return 1
  fi

  local node_output
  if node_output="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- node -e "
    const net = require('net');
    const socket = net.createConnection({ host: 'postgres-replica', port: 5432 });
    const timeout = setTimeout(() => {
      socket.destroy();
      console.error('timeout connecting to postgres-replica:5432');
      process.exit(1);
    }, 5000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      process.exit(0);
    });
    socket.on('error', (err) => {
      console.error(err.message);
      clearTimeout(timeout);
      process.exit(1);
    });
  " 2>&1)"; then
    pass "API pod $api_pod reached postgres-replica:5432"
    return 0
  fi

  fail "API pod $api_pod could not reach postgres-replica:5432. Output: ${node_output:-No output}"
}

require_kubeconfig_and_kubectl

echo "Postgres replica smoke test for staging K8s deployment"
echo "  Namespace:  $NAMESPACE"
echo "  Kubeconfig: $KUBECONFIG"

failures=0

phase_replica_query       || failures=$((failures + 1))
phase_replication_status  || failures=$((failures + 1))
phase_api_to_replica_tcp  || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All replica smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
