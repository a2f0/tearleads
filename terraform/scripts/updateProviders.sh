#!/bin/bash
# Upgrade Terraform providers across all stacks. Run from anywhere.
#
# Walks every stack that has a scripts/update.sh, runs `terraform init -upgrade`
# via that script, and reports which lock files changed.
#
# Environment toggles:
#   SKIP_BOOTSTRAP=1        Skip the bootstrap stack
#   ONLY_TIER=<tier>        Only update stacks in a specific tier (dev|staging|prod|shared)
#   ONLY_STACK=<path>       Only update a single stack (relative to terraform/stacks/, e.g. prod/k8s)
#   DRY_RUN=1               Show which stacks would be updated without running anything
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TF_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

UPDATED_LOCKS=""
FAILED_STACKS=""
SKIPPED_STACKS=""
TOTAL=0
SUCCEEDED=0

log() {
  echo "updateTerraform: $*"
}

warn() {
  echo "updateTerraform: WARNING: $*" >&2
}

# Collect all stacks with update.sh scripts.
collect_stacks() {
  local stacks=""

  # Bootstrap (no tier)
  if [ "${SKIP_BOOTSTRAP:-0}" -ne 1 ] && [ -z "${ONLY_TIER:-}" ] && [ -z "${ONLY_STACK:-}" ]; then
    if [ -f "$TF_ROOT/bootstrap/scripts/update.sh" ]; then
      stacks="bootstrap"
    fi
  fi

  # Walk stacks/<tier>/<stack>/scripts/update.sh
  for update_script in "$TF_ROOT"/stacks/*/*/scripts/update.sh; do
    [ -f "$update_script" ] || continue
    # Extract relative path: stacks/<tier>/<stack>
    local rel_path
    rel_path="$(dirname "$(dirname "$update_script")")"
    rel_path="${rel_path#"$TF_ROOT"/}"

    # Filter by tier if requested
    if [ -n "${ONLY_TIER:-}" ]; then
      local tier
      tier="$(echo "$rel_path" | cut -d/ -f2)"
      [ "$tier" = "$ONLY_TIER" ] || continue
    fi

    # Filter by specific stack if requested
    if [ -n "${ONLY_STACK:-}" ]; then
      local stack_path
      stack_path="${rel_path#stacks/}"
      [ "$stack_path" = "$ONLY_STACK" ] || continue
    fi

    stacks="$stacks${stacks:+ }$rel_path"
  done

  echo "$stacks"
}

# Run update for a single stack.
update_stack() {
  local rel_path="$1"
  local stack_dir="$TF_ROOT/$rel_path"
  local update_script="$stack_dir/scripts/update.sh"

  TOTAL=$((TOTAL + 1))
  log "[$rel_path] upgrading providers..."

  if [ "${DRY_RUN:-0}" -eq 1 ]; then
    log "[$rel_path] (dry run, skipped)"
    SKIPPED_STACKS="${SKIPPED_STACKS}  $rel_path (dry run)
"
    return 0
  fi

  # Snapshot lock file state before update
  local lock_file="$stack_dir/.terraform.lock.hcl"
  local had_lock=0
  local lock_hash_before=""
  if [ -f "$lock_file" ]; then
    had_lock=1
    lock_hash_before="$(shasum "$lock_file" | cut -d' ' -f1)"
  fi

  if bash "$update_script"; then
    SUCCEEDED=$((SUCCEEDED + 1))

    # Check if lock file was created or changed
    if [ -f "$lock_file" ]; then
      local lock_hash_after
      lock_hash_after="$(shasum "$lock_file" | cut -d' ' -f1)"
      if [ "$had_lock" -eq 0 ]; then
        log "[$rel_path] lock file created"
        UPDATED_LOCKS="${UPDATED_LOCKS}  $rel_path (new)
"
      elif [ "$lock_hash_before" != "$lock_hash_after" ]; then
        log "[$rel_path] lock file updated"
        UPDATED_LOCKS="${UPDATED_LOCKS}  $rel_path (updated)
"
      else
        log "[$rel_path] no provider changes"
      fi
    fi
  else
    warn "[$rel_path] upgrade failed"
    FAILED_STACKS="${FAILED_STACKS}  $rel_path
"
  fi
}

# --- Main ---

if ! command -v terraform >/dev/null 2>&1; then
  echo "updateTerraform: terraform is required and must be available on PATH." >&2
  exit 1
fi

STACKS="$(collect_stacks)"

if [ -z "$STACKS" ]; then
  log "no stacks matched filters (ONLY_TIER=${ONLY_TIER:-}, ONLY_STACK=${ONLY_STACK:-})"
  exit 0
fi

log "upgrading providers for $(echo "$STACKS" | wc -w | tr -d ' ') stack(s)"
echo ""

for stack in $STACKS; do
  update_stack "$stack"
  echo ""
done

# --- Summary ---
echo "============================================"
log "Results: $SUCCEEDED/$TOTAL succeeded"

if [ -n "$UPDATED_LOCKS" ]; then
  echo ""
  log "Lock files changed:"
  echo "$UPDATED_LOCKS"
fi

if [ -n "$SKIPPED_STACKS" ]; then
  echo ""
  log "Skipped:"
  echo "$SKIPPED_STACKS"
fi

if [ -n "$FAILED_STACKS" ]; then
  echo ""
  log "FAILED:"
  echo "$FAILED_STACKS"
  exit 1
fi
