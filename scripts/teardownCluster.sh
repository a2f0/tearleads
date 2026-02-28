#!/bin/bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
K8S_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/k8s/scripts"
RDS_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/rds/scripts"
S3_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/s3/scripts"
CI_SCRIPTS_DIR="$REPO_ROOT/terraform/stacks/prod/ci-artifacts/scripts"

SKIP_CI_ARTIFACTS=false
YES=false

usage() {
  cat <<EOF
Usage: $0 [options]

One-shot production cluster teardown with dependency-safe ordering:
1) rds  2) s3  3) k8s  4) ci-artifacts

Options:
  --skip-ci-artifacts  Keep ci-artifacts stack intact
  --yes                Skip interactive confirmation
  -h, --help           Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-ci-artifacts)
      SKIP_CI_ARTIFACTS=true
      shift
      ;;
    --yes)
      YES=true
      shift
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
  echo "DANGER: This will destroy production infrastructure resources."
  echo "Type DESTROY-PROD to continue:"
  read -r confirmation
  if [[ "$confirmation" != "DESTROY-PROD" ]]; then
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

echo "Starting production cluster teardown..."
run_step "Destroy prod RDS stack" "$RDS_SCRIPTS_DIR/destroy.sh" -auto-approve
run_step "Destroy prod S3 stack" "$S3_SCRIPTS_DIR/destroy.sh" -auto-approve
run_step "Destroy prod k8s stack" "$K8S_SCRIPTS_DIR/destroy.sh" -auto-approve

if [[ "$SKIP_CI_ARTIFACTS" != "true" ]]; then
  run_step "Destroy prod ci-artifacts stack" "$CI_SCRIPTS_DIR/destroy.sh" -auto-approve
fi

echo ""
echo "Production teardown complete."
