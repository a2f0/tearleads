#!/bin/bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
LOCAL_API_PORT="${LOCAL_API_PORT:-15001}"
BOB_EMAIL="${BOB_EMAIL:-bob@tearleads.com}"
BOB_PASSWORD="${BOB_PASSWORD:-test}"

usage() {
  cat <<'EOF'
Usage: scripts/smokeStagingAdminRedis.sh

Smoke-checks staging admin Redis access for Bob:
  1) login via AuthService.Login
  2) verify AdminService.GetContext returns isRootAdmin=true
  3) verify AdminService.GetRedisDbSize returns HTTP 200

Environment overrides:
  NAMESPACE        Kubernetes namespace (default: tearleads)
  KUBECONFIG       kubeconfig path (default: ~/.kube/config-staging-k8s)
  LOCAL_API_PORT   local port-forward port (default: 15001)
  BOB_EMAIL        login email (default: bob@tearleads.com)
  BOB_PASSWORD     login password (default: test)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $command_name"
    exit 1
  fi
}

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: kubeconfig not found at $KUBECONFIG_FILE"
  echo "Run terraform/stacks/staging/k8s/scripts/kubeconfig.sh first."
  exit 1
fi

require_command kubectl
require_command curl
require_command jq

export KUBECONFIG="$KUBECONFIG_FILE"

cleanup() {
  if [[ -n "${port_forward_pid:-}" ]]; then
    kill "$port_forward_pid" >/dev/null 2>&1 || true
    wait "$port_forward_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${login_response_file:-}" ]]; then
    rm -f "$login_response_file"
  fi
  if [[ -n "${context_response_file:-}" ]]; then
    rm -f "$context_response_file"
  fi
  if [[ -n "${redis_response_file:-}" ]]; then
    rm -f "$redis_response_file"
  fi
}
trap cleanup EXIT

echo "Port-forwarding service/api to localhost:$LOCAL_API_PORT..."
kubectl -n "$NAMESPACE" port-forward "service/api" "$LOCAL_API_PORT:5001" >/dev/null 2>&1 &
port_forward_pid=$!
sleep 2

if ! kill -0 "$port_forward_pid" >/dev/null 2>&1; then
  echo "ERROR: failed to start kubectl port-forward to service/api."
  exit 1
fi

api_base_url="http://127.0.0.1:$LOCAL_API_PORT/v1/connect"
login_url="$api_base_url/tearleads.v2.AuthService/Login"
context_url="$api_base_url/tearleads.v2.AdminService/GetContext"
redis_dbsize_url="$api_base_url/tearleads.v2.AdminService/GetRedisDbSize"

echo "Logging in as $BOB_EMAIL..."
login_payload="$(jq -cn --arg email "$BOB_EMAIL" --arg password "$BOB_PASSWORD" '{email: $email, password: $password}')"
login_response_file="$(mktemp)"
login_status="$(
  curl -sS -o "$login_response_file" -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    --data "$login_payload" \
    "$login_url"
)"

if [[ "$login_status" != "200" ]]; then
  echo "ERROR: login failed with HTTP $login_status"
  cat "$login_response_file"
  exit 1
fi

access_token="$(jq -r '.accessToken // empty' "$login_response_file")"
if [[ -z "$access_token" ]]; then
  echo "ERROR: login response did not contain accessToken"
  cat "$login_response_file"
  exit 1
fi

auth_header="Authorization: Bearer $access_token"

echo "Checking AdminService.GetContext..."
context_response_file="$(mktemp)"
context_status="$(
  curl -sS -o "$context_response_file" -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H "$auth_header" \
    --data '{}' \
    "$context_url"
)"

if [[ "$context_status" != "200" ]]; then
  echo "ERROR: GetContext failed with HTTP $context_status"
  cat "$context_response_file"
  exit 1
fi

is_root_admin="$(jq -r '.isRootAdmin // empty' "$context_response_file")"
organization_count="$(jq -r '(.organizations // []) | length' "$context_response_file")"
echo "  isRootAdmin=$is_root_admin organizations=$organization_count"

if [[ "$is_root_admin" != "true" ]]; then
  echo "ERROR: expected Bob to be root admin, got isRootAdmin=$is_root_admin"
  cat "$context_response_file"
  exit 1
fi

echo "Checking AdminService.GetRedisDbSize..."
redis_response_file="$(mktemp)"
redis_status="$(
  curl -sS -o "$redis_response_file" -w '%{http_code}' \
    -X POST \
    -H 'Content-Type: application/json' \
    -H "$auth_header" \
    --data '{}' \
    "$redis_dbsize_url"
)"

if [[ "$redis_status" != "200" ]]; then
  echo "ERROR: GetRedisDbSize failed with HTTP $redis_status"
  cat "$redis_response_file"
  exit 1
fi

redis_count="$(jq -r '.count // "unknown"' "$redis_response_file")"
echo "PASS: Bob authenticated as admin and Redis browser endpoint is accessible (count=$redis_count)."
