#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# shellcheck source=../../../../scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
STAGING_DOMAIN="${TF_VAR_staging_domain:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
CURL_RETRIES="${CURL_RETRIES:-5}"
CURL_RETRY_DELAY="${CURL_RETRY_DELAY:-5}"

# --- helpers ----------------------------------------------------------------

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

resolve_staging_domain() {
  if [[ -z "$STAGING_DOMAIN" ]]; then
    local k8s_hostname
    k8s_hostname=$(terraform -chdir="$STACK_DIR" output -raw k8s_hostname 2>/dev/null || true)
    STAGING_DOMAIN="${k8s_hostname#k8s.}"
  fi

  if [[ -z "$STAGING_DOMAIN" ]]; then
    echo "ERROR: Could not determine staging domain."
    echo "Set TF_VAR_staging_domain or ensure terraform output k8s_hostname is available."
    exit 1
  fi
}

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; return 1; }

# --- phases -----------------------------------------------------------------

phase_dns() {
  echo ""
  echo "Phase 1: DNS resolution"

  local api_host="api.k8s.$STAGING_DOMAIN"
  local app_host="app.k8s.$STAGING_DOMAIN"

  if ! command -v dig >/dev/null 2>&1 && ! command -v host >/dev/null 2>&1; then
    echo "  SKIP: neither dig nor host found; skipping DNS check."
    return 0
  fi

  local ok=true
  for h in "$api_host" "$app_host"; do
    local resolved=""
    if command -v dig >/dev/null 2>&1; then
      resolved="$(dig +short "$h" 2>/dev/null | head -1)"
    else
      resolved="$(host "$h" 2>/dev/null | awk '/has address/ { print $NF; exit }')"
    fi

    if [[ -n "$resolved" ]]; then
      pass "$h resolves to $resolved"
    else
      fail "$h does not resolve" || ok=false
    fi
  done

  $ok
}

phase_in_cluster_api() {
  echo ""
  echo "Phase 2: In-cluster API health check"

  local api_pod
  api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$api_pod" ]]; then
    fail "no running API pod found (label app=api)"
    return 1
  fi

  # The API container is a minimal Node.js image without wget/curl,
  # so use node to make the HTTP request.
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
  else
    fail "API pod $api_pod did not respond to /v1/ping"
  fi
}

phase_external_api() {
  echo ""
  echo "Phase 3: External API health check"

  local url="https://api.k8s.$STAGING_DOMAIN/v1/ping"
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

phase_client_api_url() {
  echo ""
  echo "Phase 4: Client baked-in API URL verification"

  local client_pod
  client_pod="$(kubectl -n "$NAMESPACE" get pods -l app=client --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"

  if [[ -z "$client_pod" ]]; then
    fail "no running client pod found (label app=client)"
    return 1
  fi

  local expected_api_url="https://api.k8s.$STAGING_DOMAIN"

  # Search broadly for any https://api.<something> URL baked into JS assets.
  # This catches both correct (api.k8s.domain) and incorrect (api.domain) URLs.
  local baked_url
  baked_url="$(kubectl -n "$NAMESPACE" exec "$client_pod" -c client -- \
    grep -roh 'https\?://api\.[a-zA-Z0-9._/-]*' /usr/share/nginx/html/assets/ 2>/dev/null \
    | sort -u | head -1 || true)"

  # Strip any trailing path (e.g. /v1) to compare just the origin
  local baked_origin="${baked_url%%/v1*}"
  baked_origin="${baked_origin%%/}"

  if [[ -z "$baked_url" ]]; then
    fail "could not find any API URL in client JS assets"
  elif [[ "$baked_origin" == "$expected_api_url" ]]; then
    pass "client JS contains correct API URL: $baked_url"
  else
    fail "client JS contains wrong API URL: $baked_url (expected $expected_api_url)"
  fi
}

phase_external_client() {
  echo ""
  echo "Phase 5: External client reachability"

  local url="https://app.k8s.$STAGING_DOMAIN/"
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

# --- main -------------------------------------------------------------------

require_kubeconfig_and_kubectl
resolve_staging_domain

echo "API smoke test for staging K8s deployment"
echo "  Domain:    $STAGING_DOMAIN"
echo "  API host:  api.k8s.$STAGING_DOMAIN"
echo "  App host:  app.k8s.$STAGING_DOMAIN"
echo "  Namespace: $NAMESPACE"
echo "  Kubeconfig: $KUBECONFIG"

failures=0

phase_dns              || failures=$((failures + 1))
phase_in_cluster_api   || failures=$((failures + 1))
phase_external_api     || failures=$((failures + 1))
phase_client_api_url   || failures=$((failures + 1))
phase_external_client  || failures=$((failures + 1))

echo ""
if (( failures == 0 )); then
  echo "All API smoke checks passed."
else
  echo "ERROR: $failures phase(s) failed."
  exit 1
fi
