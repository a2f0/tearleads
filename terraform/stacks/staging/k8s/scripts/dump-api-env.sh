#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

NAMESPACE="${NAMESPACE:-tearleads}"
KUBECONFIG_FILE="${KUBECONFIG:-$HOME/.kube/config-staging-k8s}"
SHOW_VALUES="${SHOW_VALUES:-false}"
EXPECTED_API_ENV_VARS=(
  "OPENROUTER_API_KEY"
  "JWT_SECRET"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") [--show-values] [--help]

Inspect API pod environment in staging k8s.

Options:
  --show-values   Print full env key/value pairs from the API container (sensitive).
  -h, --help      Show this help text and exit.

Environment:
  NAMESPACE       Kubernetes namespace (default: tearleads)
  KUBECONFIG      Path to kubeconfig (default: ~/.kube/config-staging-k8s)
  SHOW_VALUES     Set to "true" to print env values (same as --show-values)
EOF
}

case "${1:-}" in
  --show-values)
    SHOW_VALUES="true"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    echo "ERROR: Unknown argument: ${1}" >&2
    echo "" >&2
    usage >&2
    exit 1
    ;;
esac

if ! command -v kubectl >/dev/null 2>&1; then
  echo "ERROR: kubectl is required but not found." >&2
  echo "Please install kubectl and ensure it's in your PATH." >&2
  exit 1
fi

if [[ ! -f "$KUBECONFIG_FILE" ]]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_FILE" >&2
  echo "Run $SCRIPT_DIR/kubeconfig.sh first, then retry." >&2
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_FILE"

api_pod="$(kubectl -n "$NAMESPACE" get pods -l app=api --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -z "$api_pod" ]]; then
  echo "ERROR: No running API pod found in namespace $NAMESPACE." >&2
  exit 1
fi

echo "API pod: $api_pod"
echo "Namespace: $NAMESPACE"

if [[ "$SHOW_VALUES" == "true" ]]; then
  echo ""
  echo "Container environment values (sensitive):"
  kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- env | sort
  exit 0
fi

echo ""
echo "Container environment variable names:"
kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- env | cut -d '=' -f 1 | sort

echo ""
echo "Secret keys in tearleads-secrets:"
kubectl -n "$NAMESPACE" get secret tearleads-secrets -o go-template='{{range $k, $v := .data}}{{printf "%s\n" $k}}{{end}}' | sort

echo ""
pod_env="$(kubectl -n "$NAMESPACE" exec "$api_pod" -c api -- env)"
for expected_var in "${EXPECTED_API_ENV_VARS[@]}"; do
  if grep -q "^${expected_var}=" <<< "$pod_env"; then
    echo "${expected_var} is present in API pod env."
  else
    echo "${expected_var} is NOT present in API pod env."
  fi
done
