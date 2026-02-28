#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env prod

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-prod-k8s}"
PROD_DOMAIN="${TF_VAR_domain:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
CURL_RETRIES="${CURL_RETRIES:-5}"
CURL_RETRY_DELAY="${CURL_RETRY_DELAY:-5}"

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

resolve_prod_domain() {
  if [[ -n "$PROD_DOMAIN" ]]; then
    return
  fi

  local k8s_hostname
  k8s_hostname="$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname 2>/dev/null || true)"
  PROD_DOMAIN="${k8s_hostname#k8s.}"

  if [[ -z "$PROD_DOMAIN" ]]; then
    echo "ERROR: Could not determine production domain."
    echo "Set TF_VAR_domain or ensure terraform output k8s_hostname is available."
    exit 1
  fi
}

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; return 1; }

phase_in_cluster_api() {
  echo ""
  echo "Phase 1: In-cluster API health check"

  local api_pod
  api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$api_pod" ]]; then
    fail "no running API pod found (label app=api)"
    return 1
  fi

  local response
  response="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- \
    node -e "
      const http = require('http');
      http.get('http://localhost:5001/v1/ping', res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          process.stdout.write(d);
          process.exit(res.statusCode === 200 ? 0 : 1);
        });
      }).on('error', e => {
        process.stderr.write(e.message);
        process.exit(1);
      });
    " 2>/dev/null || true)"

  if [[ -n "$response" ]]; then
    pass "API pod $api_pod responded to /v1/ping ($response)"
    return 0
  fi

  fail "API pod $api_pod did not respond to /v1/ping"
}

phase_external_api() {
  echo ""
  echo "Phase 2: External API health check"

  local url="https://api.$PROD_DOMAIN/v1/ping"
  local attempt=1

  while (( attempt <= CURL_RETRIES )); do
    if curl -sf --max-time "$CURL_TIMEOUT" "$url" >/dev/null 2>&1; then
      pass "$url reachable (attempt $attempt)"
      return 0
    fi
    echo "  attempt $attempt/$CURL_RETRIES failed, retrying in ${CURL_RETRY_DELAY}s..."
    sleep "$CURL_RETRY_DELAY"
    ((attempt++))
  done

  fail "$url unreachable after $CURL_RETRIES attempts"
}

phase_external_client() {
  echo ""
  echo "Phase 3: External client reachability"

  local url="https://app.$PROD_DOMAIN/"
  local attempt=1

  while (( attempt <= CURL_RETRIES )); do
    if curl -sf --max-time "$CURL_TIMEOUT" "$url" >/dev/null 2>&1; then
      pass "$url reachable (attempt $attempt)"
      return 0
    fi
    echo "  attempt $attempt/$CURL_RETRIES failed, retrying in ${CURL_RETRY_DELAY}s..."
    sleep "$CURL_RETRY_DELAY"
    ((attempt++))
  done

  fail "$url unreachable after $CURL_RETRIES attempts"
}

require_kubeconfig_and_kubectl
resolve_prod_domain

echo "API smoke test for prod K8s deployment"
echo "  Domain:    $PROD_DOMAIN"
echo "  API host:  api.$PROD_DOMAIN"
echo "  App host:  app.$PROD_DOMAIN"
echo "  Namespace: $NAMESPACE"
echo "  Kubeconfig: $KUBECONFIG"

failures=0

phase_in_cluster_api || failures=$((failures + 1))
phase_external_api   || failures=$((failures + 1))
phase_external_client || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All API smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
