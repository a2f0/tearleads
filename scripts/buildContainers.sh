#!/bin/bash
# Build and push containers to ECR
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
DOCKER_BUILD_PLATFORM="${DOCKER_BUILD_PLATFORM:-linux/amd64}"

usage() {
  echo "Usage: $0 <environment> [options]"
  echo ""
  echo "Environments:"
  echo "  staging    Build and push to staging ECR repos"
  echo "  prod       Build and push to prod ECR repos"
  echo ""
  echo "Options:"
  echo "  --api-only      Only build the API container"
  echo "  --client-only   Only build the client container"
  echo "  --smtp-only     Only build the SMTP listener container"
  echo "  --website-only  Only build the website container"
  echo "  --no-smtp       Skip building the SMTP listener container"
  echo "  --no-website    Skip building the website container"
  echo "  --no-push       Build only, don't push to ECR"
  echo "  --tag TAG       Use specific tag (default: latest)"
  echo ""
  echo "Environment variables:"
  echo "  AWS_REGION      AWS region (default: us-east-1)"
  echo "  AWS_ACCOUNT_ID  AWS account ID (auto-detected if not set)"
  echo "  VITE_API_URL    API URL for client build (required for client)"
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

ENV="$1"
shift

if [[ "$ENV" != "staging" && "$ENV" != "prod" ]]; then
  echo "Error: Environment must be 'staging' or 'prod'"
  exit 1
fi

# Parse options
BUILD_API=true
BUILD_CLIENT=true
BUILD_SMTP=false
if [[ "$ENV" == "staging" ]]; then
  BUILD_SMTP=true
fi
BUILD_WEBSITE=true
PUSH=true
TAG="latest"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-only)
      BUILD_CLIENT=false
      BUILD_SMTP=false
      BUILD_WEBSITE=false
      shift
      ;;
    --client-only)
      BUILD_API=false
      BUILD_SMTP=false
      BUILD_WEBSITE=false
      shift
      ;;
    --smtp-only)
      BUILD_API=false
      BUILD_CLIENT=false
      BUILD_WEBSITE=false
      BUILD_SMTP=true
      shift
      ;;
    --website-only)
      BUILD_API=false
      BUILD_CLIENT=false
      BUILD_SMTP=false
      shift
      ;;
    --no-smtp)
      BUILD_SMTP=false
      shift
      ;;
    --no-website)
      BUILD_WEBSITE=false
      shift
      ;;
    --no-push)
      PUSH=false
      shift
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Set ECR repo names based on environment
API_REPO="tearleads-${ENV}/api"
CLIENT_REPO="tearleads-${ENV}/client"
SMTP_REPO="tearleads-${ENV}/smtp-listener"
WEBSITE_REPO="tearleads-${ENV}/website"

echo "=== Container Build Configuration ==="
echo "Environment: $ENV"
echo "ECR Registry: $ECR_REGISTRY"
echo "Tag: $TAG"
echo "Build API: $BUILD_API"
echo "Build Client: $BUILD_CLIENT"
echo "Build SMTP Listener: $BUILD_SMTP"
echo "Build Website: $BUILD_WEBSITE"
echo "Push to ECR: $PUSH"
echo "Docker Platform: $DOCKER_BUILD_PLATFORM"
echo ""

# Login to ECR
if [[ "$PUSH" == "true" ]]; then
  echo "=== Logging into ECR ==="
  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "$ECR_REGISTRY"
  echo ""
fi

cd "$REPO_ROOT"

# Build API
if [[ "$BUILD_API" == "true" ]]; then
  echo "=== Building API container ==="
  docker build \
    --platform "$DOCKER_BUILD_PLATFORM" \
    -f packages/api/Dockerfile \
    -t "${ECR_REGISTRY}/${API_REPO}:${TAG}" \
    .

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing API container ==="
    docker push "${ECR_REGISTRY}/${API_REPO}:${TAG}"
  fi
  echo ""
fi

# Build Client
if [[ "$BUILD_CLIENT" == "true" ]]; then
  # Determine API URL based on environment
  if [[ -z "${VITE_API_URL:-}" ]]; then
    if [[ "$ENV" == "staging" ]]; then
      VITE_API_URL="https://api.k8s.${TF_VAR_domain:-tearleads.dev}/v1"
    else
      VITE_API_URL="https://api.${TF_VAR_domain:-tearleads.com}/v1"
    fi
    echo "Note: VITE_API_URL not set, using default: $VITE_API_URL"
  fi

  echo "=== Building Client container ==="
  docker build \
    --platform "$DOCKER_BUILD_PLATFORM" \
    -f packages/client/Dockerfile \
    --build-arg VITE_API_URL="$VITE_API_URL" \
    -t "${ECR_REGISTRY}/${CLIENT_REPO}:${TAG}" \
    .

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing Client container ==="
    docker push "${ECR_REGISTRY}/${CLIENT_REPO}:${TAG}"
  fi
  echo ""
fi

# Build SMTP listener
if [[ "$BUILD_SMTP" == "true" ]]; then
  echo "=== Building SMTP listener container ==="
  docker build \
    --platform "$DOCKER_BUILD_PLATFORM" \
    -f packages/smtp-listener/Dockerfile \
    -t "${ECR_REGISTRY}/${SMTP_REPO}:${TAG}" \
    .

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing SMTP listener container ==="
    docker push "${ECR_REGISTRY}/${SMTP_REPO}:${TAG}"
  fi
  echo ""
fi

# Build Website
if [[ "$BUILD_WEBSITE" == "true" ]]; then
  echo "=== Building Website container ==="
  docker build \
    --platform "$DOCKER_BUILD_PLATFORM" \
    -f packages/website/Dockerfile \
    -t "${ECR_REGISTRY}/${WEBSITE_REPO}:${TAG}" \
    .

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing Website container ==="
    docker push "${ECR_REGISTRY}/${WEBSITE_REPO}:${TAG}"
  fi
  echo ""
fi

echo "=== Build complete ==="
if [[ "$PUSH" == "true" ]]; then
  echo "Images pushed to ECR:"
  if [[ "$BUILD_API" == "true" ]]; then
    echo "  - ${ECR_REGISTRY}/${API_REPO}:${TAG}"
  fi
  if [[ "$BUILD_CLIENT" == "true" ]]; then
    echo "  - ${ECR_REGISTRY}/${CLIENT_REPO}:${TAG}"
  fi
  if [[ "$BUILD_SMTP" == "true" ]]; then
    echo "  - ${ECR_REGISTRY}/${SMTP_REPO}:${TAG}"
  fi
  if [[ "$BUILD_WEBSITE" == "true" ]]; then
    echo "  - ${ECR_REGISTRY}/${WEBSITE_REPO}:${TAG}"
  fi
fi
