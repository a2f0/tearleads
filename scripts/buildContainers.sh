#!/bin/bash
# Build and push containers to ECR
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
# shellcheck source=lib/dockerHelpers.sh
source "$SCRIPT_DIR/lib/dockerHelpers.sh"
# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
ECR_REGISTRY=""
DOCKER_BUILD_PLATFORM="${DOCKER_BUILD_PLATFORM:-}"
DOCKER_BUILD_PLATFORM_SOURCE=""
PARALLEL="${PARALLEL:-false}"
MAX_PARALLEL_JOBS=1
DOCKER_MAINTENANCE="${DOCKER_MAINTENANCE:-true}"
DOCKER_MAINTENANCE_UNTIL="${DOCKER_MAINTENANCE_UNTIL:-168h}"
DOCKER_MAINTENANCE_MAX_CACHE="${DOCKER_MAINTENANCE_MAX_CACHE:-20GB}"
DOCKER_DAEMON_HEALTHCHECK_TIMEOUT="${DOCKER_DAEMON_HEALTHCHECK_TIMEOUT:-15}"
DOCKER_LOGIN_TIMEOUT="${DOCKER_LOGIN_TIMEOUT:-45}"
DOCKER_TIMEOUT_BIN="$(detect_timeout_binary)"
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
  echo "  --parallel      Build selected containers in parallel (bounded by CPU cores)"
  echo "  --no-push       Build only, don't push to ECR"
  echo "  --maintenance   Run safe Docker cleanup after successful builds"
  echo "  --no-maintenance  Skip post-build Docker cleanup"
  echo "  --maintenance-until AGE  Prune resources older than AGE (default: 168h)"
  echo "  --maintenance-max-cache SIZE  Keep build cache at or below SIZE (default: 20GB)"
  echo "  --tag TAG       Use specific tag (default: latest)"
  echo ""
  echo "Environment variables:"
  echo "  AWS_REGION      AWS region (default: us-east-1)"
  echo "  AWS_ACCOUNT_ID  AWS account ID (auto-detected when pushing)"
  echo "  DOCKER_BUILD_PLATFORM  Docker platform (linux/amd64, linux/arm64, or auto)"
  echo "  DOCKER_MAINTENANCE  Enable post-build safe cleanup (default: true)"
  echo "  DOCKER_MAINTENANCE_UNTIL  Age filter for cleanup (default: 168h)"
  echo "  DOCKER_MAINTENANCE_MAX_CACHE  Build cache cap (default: 20GB)"
  echo "  DOCKER_DAEMON_HEALTHCHECK_TIMEOUT  Docker daemon readiness timeout in seconds (default: 15)"
  echo "  DOCKER_LOGIN_TIMEOUT  docker login timeout in seconds (default: 45)"
  echo "  VITE_API_URL    API URL for client build (derived from TF_VAR_domain)"
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

# Source environment secrets
ENV_FILE="$REPO_ROOT/.secrets/${ENV}.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
else
  echo "Warning: Missing secrets file: $ENV_FILE — falling back to exported environment variables"
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Error: $name is not set. Add it to .secrets/${ENV}.env or export it."
    exit 1
  fi
}

count_selected_builds() {
  local selected=0

  if [[ "$BUILD_API" == "true" ]]; then
    selected=$((selected + 1))
  fi
  if [[ "$BUILD_API_V2" == "true" ]]; then
    selected=$((selected + 1))
  fi
  if [[ "$BUILD_CLIENT" == "true" ]]; then
    selected=$((selected + 1))
  fi
  if [[ "$BUILD_SMTP" == "true" ]]; then
    selected=$((selected + 1))
  fi
  if [[ "$BUILD_WEBSITE" == "true" ]]; then
    selected=$((selected + 1))
  fi

  echo "$selected"
}

detect_cpu_cores() {
  local cores=""

  if command -v nproc >/dev/null 2>&1; then
    cores="$(nproc)"
  elif command -v sysctl >/dev/null 2>&1; then
    cores="$(sysctl -n hw.ncpu 2>/dev/null || true)"
  fi

  if [[ -z "$cores" ]] && command -v getconf >/dev/null 2>&1; then
    cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi

  if [[ -z "$cores" || ! "$cores" =~ ^[0-9]+$ || "$cores" -lt 1 ]]; then
    cores=1
  fi

  echo "$cores"
}

detect_host_docker_platform() {
  local arch
  arch="$(uname -m)"

  case "$arch" in
    arm64|aarch64)
      echo "linux/arm64"
      ;;
    amd64|x86_64)
      echo "linux/amd64"
      ;;
    *)
      echo "linux/amd64"
      ;;
  esac
}

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
    --maintenance)
      DOCKER_MAINTENANCE=true
      shift
      ;;
    --no-maintenance)
      DOCKER_MAINTENANCE=false
      shift
      ;;
    --maintenance-until)
      DOCKER_MAINTENANCE_UNTIL="$2"
      shift 2
      ;;
    --maintenance-max-cache)
      DOCKER_MAINTENANCE_MAX_CACHE="$2"
      shift 2
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

SELECTED_BUILD_COUNT="$(count_selected_builds)"
CPU_CORES="$(detect_cpu_cores)"

if [[ "$SELECTED_BUILD_COUNT" -eq 0 ]]; then
  echo "No containers selected for build."
  exit 0
fi

if [[ "$PARALLEL" == "true" ]]; then
  MAX_PARALLEL_JOBS="$CPU_CORES"
  if [[ "$SELECTED_BUILD_COUNT" -lt "$MAX_PARALLEL_JOBS" ]]; then
    MAX_PARALLEL_JOBS="$SELECTED_BUILD_COUNT"
  fi
fi

if [[ "$DOCKER_BUILD_PLATFORM" == "auto" ]]; then
  DOCKER_BUILD_PLATFORM="$(detect_host_docker_platform)"
  DOCKER_BUILD_PLATFORM_SOURCE="auto"
elif [[ -z "$DOCKER_BUILD_PLATFORM" ]]; then
  if [[ "$PUSH" == "true" ]]; then
    # Keep push-compatible default for current runtime architecture.
    DOCKER_BUILD_PLATFORM="linux/amd64"
    DOCKER_BUILD_PLATFORM_SOURCE="default (push mode)"
  else
    # Local --no-push builds default to host architecture for speed.
    DOCKER_BUILD_PLATFORM="$(detect_host_docker_platform)"
    DOCKER_BUILD_PLATFORM_SOURCE="auto (no-push mode)"
  fi
else
  DOCKER_BUILD_PLATFORM_SOURCE="explicit"
fi

ensure_docker_daemon_ready "$DOCKER_TIMEOUT_BIN" "$DOCKER_DAEMON_HEALTHCHECK_TIMEOUT"

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
echo "Docker Platform Source: $DOCKER_BUILD_PLATFORM_SOURCE"
echo "Parallel Build: $PARALLEL"
if [[ "$PARALLEL" == "true" ]]; then
  echo "Parallel Jobs: $MAX_PARALLEL_JOBS (CPU cores: $CPU_CORES)"
fi
echo "Docker Maintenance: $DOCKER_MAINTENANCE"
if [[ "$DOCKER_MAINTENANCE" == "true" ]]; then
  echo "Maintenance Until: $DOCKER_MAINTENANCE_UNTIL"
  echo "Maintenance Max Cache: $DOCKER_MAINTENANCE_MAX_CACHE"
fi
echo "Docker Daemon Healthcheck Timeout: ${DOCKER_DAEMON_HEALTHCHECK_TIMEOUT}s"
echo "Docker Login Timeout: ${DOCKER_LOGIN_TIMEOUT}s"
if [[ "$PUSH" == "true" && "$DOCKER_BUILD_PLATFORM" != "linux/amd64" ]]; then
  echo "WARNING: Pushing non-amd64 images. Verify your runtime supports $DOCKER_BUILD_PLATFORM."
fi
if [[ -z "$DOCKER_TIMEOUT_BIN" ]]; then
  echo "WARNING: timeout command not found; Docker login timeout enforcement is disabled."
fi
echo ""

# Login to ECR
if [[ "$PUSH" == "true" ]]; then
  echo "=== Logging into ECR ==="
  docker_login_to_ecr "$DOCKER_TIMEOUT_BIN" "$DOCKER_LOGIN_TIMEOUT" "$AWS_REGION" "$ECR_REGISTRY"
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

  if [[ "$TAG" != "latest" ]]; then
    local latest_tag="${image_tag%:*}:latest"
    docker tag "$image_tag" "$latest_tag"
  fi

  if [[ "$PUSH" == "true" ]]; then
    echo "=== Pushing ${image_name} container ==="
    docker push "$image_tag"
    if [[ "$TAG" != "latest" ]]; then
      echo "=== Pushing ${image_name} container (latest) ==="
      docker push "${image_tag%:*}:latest"
    fi
  fi
  echo ""
}

declare -a BUILD_PIDS=()
declare -a BUILD_NAMES=()

wait_for_available_build_slot() {
  if [[ "$PARALLEL" != "true" ]]; then
    return
  fi

  while true; do
    local running_jobs
    running_jobs="$(jobs -rp | wc -l | tr -d '[:space:]')"
    if [[ "$running_jobs" -lt "$MAX_PARALLEL_JOBS" ]]; then
      break
    fi
    sleep 0.2
  done
}

run_or_queue_build() {
  local display_name="$1"
  shift

  if [[ "$PARALLEL" == "true" ]]; then
    wait_for_available_build_slot
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
  echo "=== Generating WASM bindings for client ==="
  "$SCRIPT_DIR/codegenWasm.sh"
  echo ""

  # Determine API URL based on environment
  if [[ -z "${VITE_API_URL:-}" ]]; then
    require_var TF_VAR_domain
    # shellcheck disable=SC2154  # TF_VAR_domain sourced from .secrets/<env>.env
    VITE_API_URL="https://api.${TF_VAR_domain}/v1"
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

run_docker_maintenance_safe "$DOCKER_MAINTENANCE" "$DOCKER_MAINTENANCE_UNTIL" "$DOCKER_MAINTENANCE_MAX_CACHE"

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
  if [[ "$TAG" != "latest" ]]; then
    echo "  (also pushed as :latest)"
  fi
fi
