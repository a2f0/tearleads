#!/bin/sh
set -eu
export TF_WORKSPACE="${TF_WORKSPACE_K8S:?TF_WORKSPACE_K8S is not set}"

cd "$(dirname "$0")/.."
DOMAIN="${TF_VAR_domain:?TF_VAR_domain is not set}"
MANIFESTS_DIR="$(pwd)/manifests"

# Get kubeconfig if not already set
if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG="${HOME}/.kube/config-k8s"
  if [ ! -f "$KUBECONFIG" ]; then
    echo "Fetching kubeconfig..."
    ./scripts/kubeconfig.sh
  fi
  export KUBECONFIG
fi

echo "Deploying to k8s cluster..."

# Replace domain placeholder in ingress
INGRESS_TEMP=$(mktemp)
sed "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" "${MANIFESTS_DIR}/ingress.yaml" > "$INGRESS_TEMP"

# Apply manifests in order
echo "Creating namespace..."
kubectl apply -f "${MANIFESTS_DIR}/namespace.yaml"

echo "Applying secrets and configmap..."
kubectl apply -f "${MANIFESTS_DIR}/secrets.yaml"
kubectl apply -f "${MANIFESTS_DIR}/configmap.yaml"

echo "Deploying PostgreSQL..."
kubectl apply -f "${MANIFESTS_DIR}/postgres.yaml"

echo "Deploying Redis..."
kubectl apply -f "${MANIFESTS_DIR}/redis.yaml"

echo "Waiting for databases to be ready..."
kubectl -n tearleads wait --for=condition=ready pod -l app=postgres --timeout=120s
kubectl -n tearleads wait --for=condition=ready pod -l app=redis --timeout=60s

echo "Deploying API..."
kubectl apply -f "${MANIFESTS_DIR}/api.yaml"

echo "Deploying client..."
kubectl apply -f "${MANIFESTS_DIR}/client.yaml"

echo "Deploying website..."
kubectl apply -f "${MANIFESTS_DIR}/website.yaml"

echo "Applying ingress..."
kubectl apply -f "$INGRESS_TEMP"
rm -f "$INGRESS_TEMP"

echo "Waiting for pods to be ready..."
kubectl -n tearleads wait --for=condition=ready pod -l app=api --timeout=120s
kubectl -n tearleads wait --for=condition=ready pod -l app=client --timeout=60s
kubectl -n tearleads wait --for=condition=ready pod -l app=website --timeout=60s

echo ""
echo "Deployment complete!"
echo ""
kubectl -n tearleads get pods
echo ""
echo "Services:"
echo "  Website: https://k8s.${DOMAIN}"
echo "  Client:  https://app.k8s.${DOMAIN}"
echo "  API:     https://api.k8s.${DOMAIN}"
