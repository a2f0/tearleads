# shellcheck shell=sh
# The shared screenshot store, reached through the take-screenshots skill. Not
# executable on its own: source it.
#
#   . "$REPO_ROOT/scripts/lib/screenshotsStore.sh"
#   screenshots_store_link "$REPO_ROOT"
#   artifacts=$(screenshots_store_script) || echo "skill not installed"
#
# A clone's gitignored .screenshots links into the matrix-artifacts store every
# clone on this machine shares, and only the skill's artifacts.ts writes there.
# POSIX sh throughout: callers run under /bin/sh.

# Prints the skill's artifacts.ts, or fails when the skill is not installed, as
# in CI or on another machine. TAKE_SCREENSHOTS_ARTIFACTS overrides the path.
screenshots_store_script() {
  if [ -n "${TAKE_SCREENSHOTS_ARTIFACTS:-}" ]; then
    printf '%s\n' "$TAKE_SCREENSHOTS_ARTIFACTS"
    return 0
  fi
  for screenshots_store_candidate in \
    "$HOME/.agents/skills/take-screenshots/scripts/artifacts.ts" \
    "$HOME/.claude/skills/take-screenshots/scripts/artifacts.ts"; do
    if [ -f "$screenshots_store_candidate" ]; then
      printf '%s\n' "$screenshots_store_candidate"
      return 0
    fi
  done
  return 1
}

# Links the clone at $1 to the store when it has no .screenshots at all, so a
# capture, build, or deploy from a fresh clone or worktree uses the shared
# captures instead of a local or empty directory. A clone that already holds a
# .screenshots is left alone: choosing between two captures is the skill's
# `link`. Without the skill it does nothing, and it never fails its caller.
screenshots_store_link() {
  if [ -e "$1/.screenshots" ] || [ -L "$1/.screenshots" ]; then
    return 0
  fi
  screenshots_store_artifacts=$(screenshots_store_script) || return 0
  (cd "$1" && bun "$screenshots_store_artifacts" link --apply) ||
    echo "warning: could not link .screenshots to the shared screenshot store; run the take-screenshots skill's link" >&2
  return 0
}
