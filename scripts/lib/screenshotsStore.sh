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

# Prints the store that the clone at $1 resolves with the agent-tool CLI at $2:
# MATRIX_ARTIFACTS_DIR, else matrix-artifacts beside its matrix workspace, else
# beside the clone. The store need not exist. Fails when the CLI cannot report
# one, as outside a Git checkout.
screenshots_store_resolve() {
  # status exits 1 while the clone is unlinked and names the store either way;
  # MATRIX_ARTIFACTS_NO_GH skips asking GitHub for a namespace this never reads.
  screenshots_store_report=$(cd "$1" &&
    MATRIX_ARTIFACTS_NO_GH=1 "$2" screenshots status --json 2>/dev/null) || :
  printf '%s' "$screenshots_store_report" | bun -e '
const report = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (typeof report?.artifacts !== "string" || report.artifacts === "") process.exit(1);
process.stdout.write(report.artifacts);
' 2>/dev/null
}

# Links the clone at $1 to the store when it has no .screenshots at all and the
# store already exists, so a capture, build, or deploy from a fresh clone or
# worktree uses the shared captures instead of a local or empty directory. A
# clone that already holds a .screenshots is left alone: choosing between two
# captures is the skill's `link`. It never creates a store: CI and a machine
# that never used one have none, and the take-screenshots skill's `link` or
# `capture` creates it on purpose. Without the store or the installed CLI it
# does nothing, and it never fails its caller.
screenshots_store_link() {
  if [ -e "$1/.screenshots" ] || [ -L "$1/.screenshots" ]; then
    return 0
  fi
  screenshots_store_agent_tool=$(screenshots_store_cli "$1") || return 0
  screenshots_store_root=$(screenshots_store_resolve "$1" "$screenshots_store_agent_tool") || {
    echo "warning: agent-tool screenshots status named no store, so .screenshots stays unlinked" >&2
    return 0
  }
  [ -d "$screenshots_store_root" ] || return 0
  (cd "$1" && "$screenshots_store_agent_tool" screenshots link --apply) ||
    echo "warning: could not link .screenshots to the shared screenshot store; run the take-screenshots skill's link" >&2
  return 0
}
