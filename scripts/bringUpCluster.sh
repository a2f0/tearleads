#!/bin/bash
set -euo pipefail

if [[ -z "${BASH_VERSION:-}" ]]; then
  echo "ERROR: This script requires bash. Run with: bash ./scripts/bringUpCluster.sh ..."
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
K8S_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/k8s/scripts"
RDS_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/rds/scripts"
S3_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/s3/scripts"
CI_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/ci-artifacts/scripts"

# shellcheck disable=SC1091
# shellcheck source=../terraform/scripts/common.sh
source "$REPO_ROOT/terraform/scripts/common.sh"
load_secrets_env prod

SKIP_BUILD=false
SKIP_ROLLOUT=false
SKIP_MIGRATE=false
SKIP_SMOKE=false
SKIP_WEBSITE=false
YES=false
IMAGE_TAG=""
SCRIPT_START_TS="$(date +%s)"
TF_APPLY_AUTO_APPROVE=""
MIGRATE_RETRIES="${MIGRATE_RETRIES:-4}"
MIGRATE_RETRY_DELAY_SECONDS="${MIGRATE_RETRY_DELAY_SECONDS:-20}"

usage() {
  cat <<EOF
Usage: $0 [options]

One-shot production cluster bring-up with dependency ordering:
1) ci-artifacts  2) s3  3) k8s infra  4) rds
5) k8s bootstrap 6) buildContainers 7) rollout 8) migrate 9) smoke tests

Options:
  --skip-build      Skip container build/push
  --skip-rollout    Skip deployment restart rollout
  --skip-migrate    Skip API migration step
  --skip-smoke      Skip smoke tests
  --skip-website    Skip website image build and rollout
  --yes, -y         Skip interactive confirmation
  --yes=true        Equivalent to --yes
  --tag <tag>       Image tag for buildContainers (default: latest)
  -h, --help        Show help

Environment:
  MIGRATE_RETRIES              Migration retry attempts (default: 4)
  MIGRATE_RETRY_DELAY_SECONDS  Delay between migration retries (default: 20)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-rollout)
      SKIP_ROLLOUT=true
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=true
      shift
      ;;
    --skip-smoke)
      SKIP_SMOKE=true
      shift
      ;;
    --skip-website)
      SKIP_WEBSITE=true
      shift
      ;;
    --yes)
      YES=true
      shift
      ;;
    -y)
      YES=true
      shift
      ;;
    --yes=true)
      YES=true
      shift
      ;;
    --yes=false)
      YES=false
      shift
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
      if [[ -z "$IMAGE_TAG" ]]; then
        echo "ERROR: --tag requires a value."
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "${YES:-false}" != "true" && "${YES:-0}" != "1" ]]; then
  echo "This will apply production infra, build/push containers, and run rollout + smoke tests."
  echo "Type BRINGUP-PROD to continue:"
  read -r confirmation
  if [[ "$confirmation" != "BRINGUP-PROD" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

if [[ "${YES:-false}" == "true" || "${YES:-0}" == "1" ]]; then
  TF_APPLY_AUTO_APPROVE="-auto-approve"
fi

format_duration() {
  local total_seconds="$1"
  local minutes=$((total_seconds / 60))
  local seconds=$((total_seconds % 60))
  printf "%dm %02ds" "$minutes" "$seconds"
}

run_step() {
  local label="$1"
  shift
  local step_start_ts
  local step_end_ts
  local step_elapsed
  local step_status

  step_start_ts="$(date +%s)"
  echo ""
  echo "==> $label"
  set +e
  "$@"
  step_status=$?
  set -e
  step_end_ts="$(date +%s)"
  step_elapsed=$((step_end_ts - step_start_ts))

  if [[ $step_status -eq 0 ]]; then
    echo "<== $label completed in $(format_duration "$step_elapsed")"
  else
    echo "<== $label failed in $(format_duration "$step_elapsed") (exit: $step_status)"
  fi

  return $step_status
}

run_step_with_retry() {
  local label="$1"
  local retries="$2"
  local delay_seconds="$3"
  shift 3

  local attempt=1
  while (( attempt <= retries )); do
    echo ""
    echo "Attempt $attempt/$retries: $label"
    if run_step "$label" "$@"; then
      return 0
    fi

    if (( attempt == retries )); then
      echo "ERROR: $label failed after $retries attempts."
      return 1
    fi

    echo "Retrying in ${delay_seconds}s..."
    sleep "$delay_seconds"
    ((attempt++))
  done
}

echo "Starting production cluster bring-up..."

apply_args=()
if [[ -n "$TF_APPLY_AUTO_APPROVE" ]]; then
  apply_args+=("$TF_APPLY_AUTO_APPROVE")
fi

run_step "Apply prod ci-artifacts (ECR + CI bucket)" "$CI_SCRIPTS_DIR/apply.sh" "${apply_args[@]}"
run_step "Apply prod S3 (bucket + IAM credentials)" "$S3_SCRIPTS_DIR/apply.sh" "${apply_args[@]}"
run_step "Apply prod k8s infrastructure" "$K8S_SCRIPTS_DIR/apply01.sh" "${apply_args[@]}"
run_step "Apply prod RDS (private in k8s VPC)" "$RDS_SCRIPTS_DIR/apply.sh" "${apply_args[@]}"
run_step "Bootstrap prod k8s and deploy manifests" "$K8S_SCRIPTS_DIR/apply02.sh"

if [[ "$SKIP_BUILD" != "true" ]]; then
  validate_aws_env
  build_args=("prod")
  if [[ "$SKIP_WEBSITE" == "true" ]]; then
    build_args+=("--no-website")
  fi
  if [[ -n "$IMAGE_TAG" ]]; then
    build_args+=("--tag" "$IMAGE_TAG")
  fi
  run_step "Build and push prod containers" "$REPO_ROOT/scripts/buildContainers.sh" "${build_args[@]}"
fi

if [[ "$SKIP_ROLLOUT" != "true" ]]; then
  if [[ "$SKIP_WEBSITE" == "true" ]]; then
    run_step "Rollout prod deployments" env SKIP_WEBSITE=true "$K8S_SCRIPTS_DIR/rollout.sh"
  else
    run_step "Rollout prod deployments" "$K8S_SCRIPTS_DIR/rollout.sh"
  fi
fi

if [[ "$SKIP_SMOKE" != "true" ]]; then
  run_step_with_retry \
    "Run prod Postgres smoke test" \
    "$MIGRATE_RETRIES" \
    "$MIGRATE_RETRY_DELAY_SECONDS" \
    "$K8S_SCRIPTS_DIR/smoke-postgres.sh"
fi

if [[ "$SKIP_MIGRATE" != "true" ]]; then
  run_step_with_retry \
    "Run API migrations" \
    "$MIGRATE_RETRIES" \
    "$MIGRATE_RETRY_DELAY_SECONDS" \
    "$K8S_SCRIPTS_DIR/migrate.sh"
fi

if [[ "$SKIP_SMOKE" != "true" ]]; then
  run_step "Run prod API smoke test" "$K8S_SCRIPTS_DIR/smoke-api.sh"
fi

SCRIPT_END_TS="$(date +%s)"
TOTAL_ELAPSED=$((SCRIPT_END_TS - SCRIPT_START_TS))

echo ""
echo "Production bring-up complete."
echo "Total elapsed time: $(format_duration "$TOTAL_ELAPSED")"
