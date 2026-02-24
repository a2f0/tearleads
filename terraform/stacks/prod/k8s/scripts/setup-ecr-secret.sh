#!/bin/bash
# Create or update ECR registry secret for k8s
# Run this before deploying or set up as a CronJob (tokens expire after 12 hours)
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="$(dirname "$SCRIPT_DIR")"

# Source common functions
source "$STACK_DIR/../../../scripts/common.sh"

load_secrets_env prod

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
NAMESPACE="tearleads"
SECRET_NAME="ecr-registry"

echo "=== Setting up ECR registry secret ==="
echo "Registry: $ECR_REGISTRY"
echo "Namespace: $NAMESPACE"
echo ""

# Get ECR login token
ECR_TOKEN=$(aws ecr get-login-password --region "$AWS_REGION")

# Delete existing secret if it exists
kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE" 2>/dev/null || true

# Create docker-registry secret
kubectl create secret docker-registry "$SECRET_NAME" \
  --namespace="$NAMESPACE" \
  --docker-server="$ECR_REGISTRY" \
  --docker-username=AWS \
  --docker-password="$ECR_TOKEN"

echo ""
echo "=== ECR secret created ==="
echo "Note: ECR tokens expire after 12 hours. Re-run this script or set up a CronJob to refresh."
