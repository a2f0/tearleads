#!/usr/bin/env bash
# Destroy one tier's Terraform stack: plan the destruction into a private file,
# then apply exactly that plan through the stack's wrapper. The wrappers keep
# refusing a production `destroy`; this saved-plan route is the documented
# alternative for an authorized teardown.
#
# Production data resources set prevent_destroy. For the run, a gitignored
# greenfield_reset_override.tf lifts it for exactly the resources the stack's
# configuration protects, and is removed however the run ends. An override left
# by an earlier run stops this one instead of being reused or deleted.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <staging|prod> <edge|postgres|storage|downloads|website>" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 1
fi
TIER="$1"
STACK="$2"
case "$STACK" in
  edge | postgres | storage | downloads | website) ;;
  *)
    usage
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
# shellcheck source=./teardownGuard.sh
# shellcheck disable=SC1091
source "$REPO_ROOT/terraform/scripts/teardownGuard.sh"
require_teardown_authorized "$TIER"

STACK_DIR="$REPO_ROOT/terraform/stacks/$TIER/$STACK"
OVERRIDE="$STACK_DIR/greenfield_reset_override.tf"
if [[ -e "$OVERRIDE" ]]; then
  echo "ERROR: $OVERRIDE already exists. Find the run that left it before removing it." >&2
  exit 1
fi

# Plans hold the stack's sensitive values, such as database credentials.
umask 077
PLAN_DIR="$(mktemp -d)"
trap 'rm -f "$OVERRIDE"; rm -rf "$PLAN_DIR"' EXIT

# "<type> <name>" for each top-level resource whose lifecycle sets
# prevent_destroy = true, as terraform fmt lays the configuration out.
PROTECTED="$(awk '
  FNR == 1 { resource = "" }
  /^resource "[^"]+" "[^"]+"/ { split($0, parts, "\""); resource = parts[2] " " parts[4] }
  /^}/ { resource = "" }
  resource != "" && /^[[:space:]]+prevent_destroy[[:space:]]*=[[:space:]]*true/ { print resource }
' "$STACK_DIR"/*.tf)"
if [[ -n "$PROTECTED" ]]; then
  while read -r type name; do
    echo "Lifting prevent_destroy on $type.$name for this run." >&2
    printf 'resource "%s" "%s" {\n  lifecycle {\n    prevent_destroy = false\n  }\n}\n\n' "$type" "$name"
  done <<<"$PROTECTED" >"$OVERRIDE"
fi

WRAPPER="$REPO_ROOT/terraform/scripts/run-$STACK-stack.sh"
"$WRAPPER" "$TIER" plan -destroy -out="$PLAN_DIR/destroy.tfplan"
"$WRAPPER" "$TIER" apply "$PLAN_DIR/destroy.tfplan"
