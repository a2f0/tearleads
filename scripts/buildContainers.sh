#!/bin/bash
# Build and push containers to ECR
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
ECR_REGISTRY=""
DOCKER_BUILD_PLATFORM="${DOCKER_BUILD_PLATFORM:-linux/amd64}"
PARALLEL="${PARALLEL:-false}"

usage() {
  echo "Usage: $0 <environment> [options]"
  echo ""
  echo "Environments:"
  echo "  staging    Build and push to staging ECR repos"
  echo "  prod       Build and push to prod ECR repos"
  echo ""
  echo "Options:"
  echo "  --api-only      Only build the API container"
  echo "  --api-v2-only   Only build the API v2 container"
  echo "  --client-only   Only build the client container"
  echo "  --smtp-only     Only build the SMTP listener container"
  echo "  --website-only  Only build the website container"
  echo "  --no-api-v2     Skip building the API v2 container"
  echo "  --no-smtp       Skip building the SMTP listener container"
  echo "  --no-website    Skip building the website container"
  echo "  --parallel      Build selected containers in parallel"
  echo "  --no-push       Build only, don't push to ECR"
  echo "  --tag TAG       Use specific tag (default: latest)"
  echo ""
  echo "Environment variables:"
  echo "  AWS_REGION      AWS region (default: us-east-1)"
  echo "  AWS_ACCOUNT_ID  AWS account ID (auto-detected when pushing)"
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
BUILD_API_V2=false
if [[ "$ENV" == "staging" ]]; then
  BUILD_API_V2=true
fi
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
      BUILD_API_V2=false
      BUILD_CLIENT=false
      BUILD_SMTP=false
      BUILD_WEBSITE=false
      shift
      ;;
    --api-v2-only)
      BUILD_API=false
      BUILD_CLIENT=false
      BUILD_SMTP=false
      BUILD_WEBSITE=false
      BUILD_API_V2=true
      shift
      ;;
    --client-only)
      BUILD_API=false
      BUILD_API_V2=false
      BUILD_SMTP=false
      BUILD_WEBSITE=false
      shift
      ;;
    --smtp-only)
      BUILD_API=false
      BUILD_API_V2=false
      BUILD_CLIENT=false
      BUILD_WEBSITE=false
      BUILD_SMTP=true
      shift
      ;;
    --website-only)
      BUILD_API=false
      BUILD_API_V2=false
      BUILD_CLIENT=false
      BUILD_SMTP=false
      shift
      ;;
    --no-api-v2)
      BUILD_API_V2=false
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
    --parallel)
      PARALLEL=true
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

# Resolve AWS account ID after parsing options so usage/help paths do not require AWS calls.
if [[ -z "$AWS_ACCOUNT_ID" ]]; then
  if [[ "$PUSH" == "true" ]]; then
    AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
  else
    # --no-push builds do not require live AWS credentials; use a deterministic local tag prefix.
    AWS_ACCOUNT_ID="000000000000"
  fi
fi

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Set ECR repo names based on environment
API_REPO="tearleads-${ENV}/api"
API_V2_REPO="tearleads-${ENV}/api-v2"
CLIENT_REPO="tearleads-${ENV}/client"
SMTP_REPO="tearleads-${ENV}/smtp-listener"
WEBSITE_REPO="tearleads-${ENV}/website"

echo "=== Container Build Configuration ==="
echo "Environment: $ENV"
echo "ECR Registry: $ECR_REGISTRY"
echo "Tag: $TAG"
echo "Build API: $BUILD_API"
echo "Build API V2: $BUILD_API_V2"
echo "Build Client: $BUILD_CLIENT"
echo "Build SMTP Listener: $BUILD_SMTP"
echo "Build Website: $BUILD_WEBSITE"
echo "Push to ECR: $PUSH"
echo "Docker Platform: $DOCKER_BUILD_PLATFORM"
echo "Parallel Build: $PARALLEL"
echo ""

# Login to ECR
if [[ "$PUSH" == "true" ]]; then
  echo "=== Logging into ECR ==="
  aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "$ECR_REGISTRY"
  echo ""
fi

cd "$REPO_ROOT"

build_and_push_image() {
  local image_name="$1"
  local dockerfile="$2"
  local image_tag="$3"
  shift 3

  echo "=== Building ${image_name} container ==="
  docker build \
    --platform "$DOCKER_BUILD_PLATFORM" \
    -f "$dockerfile" \
    "$@" \
    -t "$image_tag" \
    .

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing ${image_name} container ==="
    docker push "$image_tag"
  fi
  echo ""
}

declare -a BUILD_PIDS=()
declare -a BUILD_NAMES=()

run_or_queue_build() {
  local display_name="$1"
  shift

  if [[ "$PARALLEL" == "true" ]]; then
    build_and_push_image "$display_name" "$@" &
    BUILD_PIDS+=("$!")
    BUILD_NAMES+=("$display_name")
    return
  fi

  build_and_push_image "$display_name" "$@"
}

# Build API
if [[ "$BUILD_API" == "true" ]]; then
  run_or_queue_build \
    "API" \
    packages/api/Dockerfile \
    "${ECR_REGISTRY}/${API_REPO}:${TAG}"
fi

# Build API v2
if [[ "$BUILD_API_V2" == "true" ]]; then
  run_or_queue_build \
    "API v2" \
    crates/api-v2/Dockerfile \
    "${ECR_REGISTRY}/${API_V2_REPO}:${TAG}"
fi

# Build Client
if [[ "$BUILD_CLIENT" == "true" ]]; then
  # Determine API URL based on environment
  if [[ -z "${VITE_API_URL:-}" ]]; then
    if [[ "$ENV" == "staging" ]]; then
      VITE_API_URL="https://api.${TF_VAR_domain:-tearleads.dev}/v1"
    else
      VITE_API_URL="https://api.${TF_VAR_domain:-tearleads.com}/v1"
    fi
    echo "Note: VITE_API_URL not set, using default: $VITE_API_URL"
  fi

  run_or_queue_build \
    "Client" \
    packages/client/Dockerfile \
    "${ECR_REGISTRY}/${CLIENT_REPO}:${TAG}" \
    --build-arg VITE_API_URL="$VITE_API_URL"
fi

# Build SMTP listener
if [[ "$BUILD_SMTP" == "true" ]]; then
  run_or_queue_build \
    "SMTP listener" \
    packages/smtp-listener/Dockerfile \
    "${ECR_REGISTRY}/${SMTP_REPO}:${TAG}"
fi

# Build Website
if [[ "$BUILD_WEBSITE" == "true" ]]; then
  if [[ "$ENV" == "prod" ]]; then
    WEBSITE_NOINDEX="false"
  else
    WEBSITE_NOINDEX="true"
  fi

  run_or_queue_build \
    "Website" \
    packages/website/Dockerfile \
    "${ECR_REGISTRY}/${WEBSITE_REPO}:${TAG}" \
    --build-arg PUBLIC_NOINDEX="$WEBSITE_NOINDEX"
fi

if [[ "$PARALLEL" == "true" && "${#BUILD_PIDS[@]}" -gt 0 ]]; then
  failures=0

  for i in "${!BUILD_PIDS[@]}"; do
    if ! wait "${BUILD_PIDS[$i]}"; then
      echo "ERROR: ${BUILD_NAMES[$i]} container build failed"
      failures=$((failures + 1))
    fi
  done

  if [[ "$failures" -gt 0 ]]; then
    echo "Build failed for $failures container(s)."
    exit 1
  fi
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
