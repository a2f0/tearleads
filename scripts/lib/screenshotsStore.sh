# shellcheck shell=sh
# The shared screenshot store, reached through the pinned agent-tool's
# `screenshots` commands. Not executable on its own: source it.
#
#   . "$REPO_ROOT/scripts/lib/screenshotsStore.sh"
#   screenshots_store_link "$REPO_ROOT"
#   agent_tool=$(screenshots_store_cli "$REPO_ROOT") || echo "not installed"
#
# A clone's gitignored .screenshots links into the matrix-artifacts store every
# clone on this machine shares, and only `agent-tool screenshots` writes there.
# POSIX sh throughout: callers run under /bin/sh.

# Prints the clone at $1's pinned agent-tool CLI, or fails before its
# dependencies are installed.
screenshots_store_cli() {
  if [ -x "$1/node_modules/.bin/agent-tool" ]; then
    printf '%s\n' "$1/node_modules/.bin/agent-tool"
    return 0
  fi
  return 1
}

# Prints the store the clone at $1 resolves (MATRIX_ARTIFACTS_DIR, else
# matrix-artifacts beside its matrix workspace, else beside the clone) when that
# store already exists, or fails: CI and a machine that never used the store
# have none, and this never creates one. The take-screenshots skill's `link` or
# `capture` creates the store on purpose.
screenshots_store_existing() {
  screenshots_store_agent_tool=$(screenshots_store_cli "$1") || return 1
  # status exits 1 while the clone is unlinked and names the store either way;
  # MATRIX_ARTIFACTS_NO_GH skips asking GitHub for a namespace this never reads.
  screenshots_store_report=$(cd "$1" &&
    MATRIX_ARTIFACTS_NO_GH=1 "$screenshots_store_agent_tool" screenshots status --json 2>/dev/null) || :
  screenshots_store_root=$(printf '%s' "$screenshots_store_report" | bun -e '
const report = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (typeof report?.artifacts !== "string") process.exit(1);
process.stdout.write(report.artifacts);
' 2>/dev/null) || return 1
  if [ -n "$screenshots_store_root" ] && [ -d "$screenshots_store_root" ]; then
    printf '%s\n' "$screenshots_store_root"
    return 0
  fi
  return 1
}

# Links the clone at $1 to the store when it has no .screenshots at all and the
# store already exists, so a capture, build, or deploy from a fresh clone or
# worktree uses the shared captures instead of a local or empty directory. A
# clone that already holds a .screenshots is left alone: choosing between two
# captures is the skill's `link`. Without the store or the installed CLI it does
# nothing, and it never fails its caller.
screenshots_store_link() {
  if [ -e "$1/.screenshots" ] || [ -L "$1/.screenshots" ]; then
    return 0
  fi
  screenshots_store_existing "$1" >/dev/null || return 0
  (cd "$1" && "$screenshots_store_agent_tool" screenshots link --apply) ||
    echo "warning: could not link .screenshots to the shared screenshot store; run the take-screenshots skill's link" >&2
  return 0
}
