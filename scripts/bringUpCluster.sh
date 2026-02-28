#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
K8S_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/k8s/scripts"
RDS_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/rds/scripts"
S3_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/s3/scripts"
CI_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/ci-artifacts/scripts"

SKIP_BUILD=false
SKIP_ROLLOUT=false
SKIP_MIGRATE=false
SKIP_SMOKE=false
SKIP_WEBSITE=false
YES=false
IMAGE_TAG=""

usage() {
  cat <<EOF
Usage: $0 [options]

One-shot production cluster bring-up with dependency ordering:
1) ci-artifacts  2) rds  3) s3  4) k8s infra/bootstrap
5) buildContainers 6) rollout 7) migrate 8) smoke tests

Options:
  --skip-build      Skip container build/push
  --skip-rollout    Skip deployment restart rollout
  --skip-migrate    Skip API migration step
  --skip-smoke      Skip smoke tests
  --skip-website    Skip website image build and rollout
  --yes             Skip interactive confirmation
  --tag <tag>       Image tag for buildContainers (default: latest)
  -h, --help        Show help
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

if [[ "$YES" != "true" ]]; then
  echo "This will apply production infra, build/push containers, and run rollout + smoke tests."
  echo "Type BRINGUP-PROD to continue:"
  read -r confirmation
  if [[ "$confirmation" != "BRINGUP-PROD" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

run_step() {
  local label="$1"
  shift
  echo ""
  echo "==> $label"
  "$@"
}

echo "Starting production cluster bring-up..."

run_step "Apply prod ci-artifacts (ECR + CI bucket)" "$CI_SCRIPTS_DIR/apply.sh"
run_step "Apply prod RDS" "$RDS_SCRIPTS_DIR/apply.sh"
run_step "Apply prod S3 (bucket + IAM credentials)" "$S3_SCRIPTS_DIR/apply.sh"
run_step "Apply prod k8s infrastructure" "$K8S_SCRIPTS_DIR/apply01.sh"
run_step "Bootstrap prod k8s and deploy manifests" "$K8S_SCRIPTS_DIR/apply02.sh"

if [[ "$SKIP_BUILD" != "true" ]]; then
  build_cmd=("$REPO_ROOT/scripts/buildContainers.sh" "prod")
  if [[ "$SKIP_WEBSITE" == "true" ]]; then
    build_cmd+=("--no-website")
  fi
  if [[ -n "$IMAGE_TAG" ]]; then
    build_cmd+=("--tag" "$IMAGE_TAG")
  fi
  run_step "Build and push prod containers" "${build_cmd[@]}"
fi

if [[ "$SKIP_ROLLOUT" != "true" ]]; then
  if [[ "$SKIP_WEBSITE" == "true" ]]; then
    run_step "Rollout prod deployments" env SKIP_WEBSITE=true "$K8S_SCRIPTS_DIR/rollout.sh"
  else
    run_step "Rollout prod deployments" "$K8S_SCRIPTS_DIR/rollout.sh"
  fi
fi

if [[ "$SKIP_MIGRATE" != "true" ]]; then
  run_step "Run API migrations" "$K8S_SCRIPTS_DIR/migrate.sh"
fi

if [[ "$SKIP_SMOKE" != "true" ]]; then
  run_step "Run prod Postgres smoke test" "$K8S_SCRIPTS_DIR/smoke-postgres.sh"
  run_step "Run prod API smoke test" "$K8S_SCRIPTS_DIR/smoke-api.sh"
fi

echo ""
echo "Production bring-up complete."
