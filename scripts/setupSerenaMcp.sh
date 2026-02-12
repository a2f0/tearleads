#!/bin/sh
set -eu

usage() {
  cat <<'USAGE'
Usage: scripts/setupSerenaMcp.sh [--dry-run]

Configures Serena MCP for both Codex and Claude Code on this machine.
- Codex: configures a stdio MCP server named "serena" with --context codex
- Claude Code: configures a local MCP server named "serena" with --context claude-code and --project <repo-root>

Options:
  --dry-run  Print commands without applying changes
  -h, --help Show this help text
USAGE
}

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

check_dep() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: $1 CLI is not installed or not on PATH" >&2
    exit 1
  fi
}

check_dep codex
check_dep claude

repo_root=$(git rev-parse --show-toplevel)

resolve_uvx() {
  if command -v uvx >/dev/null 2>&1 && uvx --version >/dev/null 2>&1; then
    command -v uvx
    return 0
  fi

  if command -v pyenv >/dev/null 2>&1; then
    pyenv_root=$(pyenv root)
    uvx_candidates=$(find "$pyenv_root/versions" -path '*/bin/uvx' -type f 2>/dev/null || true)
    if [ -n "$uvx_candidates" ]; then
      first_uvx=$(printf '%s\n' "$uvx_candidates" | head -n 1)
      if [ -x "$first_uvx" ] && "$first_uvx" --version >/dev/null 2>&1; then
        printf '%s\n' "$first_uvx"
        return 0
      fi
    fi
  fi

  return 1
}

if ! uvx_bin=$(resolve_uvx); then
  echo "Error: uvx is required. Install uv first: https://docs.astral.sh/uv/" >&2
  exit 1
fi

run() {
  if [ "$DRY_RUN" = true ]; then
    printf '[dry-run] '
    # Portable print of arguments (space-separated, best-effort quoting)
    for arg do
      # Quote args containing spaces or tabs
      case $arg in
        *[!A-Za-z0-9_./-]*) printf "'%s' " "$(printf '%s' "$arg" | sed "s/'/'\\''/g")" ;;
        *) printf '%s ' "$arg" ;;
      esac
    done
    printf '\n'
  else
    "$@"
  fi
}

echo "Using uvx binary: $uvx_bin"
echo "Configuring Codex MCP server: serena"
run codex mcp remove serena >/dev/null 2>&1 || true
run codex mcp add serena -- "$uvx_bin" --from git+https://github.com/oraios/serena serena start-mcp-server --context codex --open-web-dashboard false

echo "Configuring Claude Code MCP server: serena (scope=local)"
run claude mcp remove --scope local serena >/dev/null 2>&1 || true
run claude mcp add --scope local serena -- "$uvx_bin" --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project "$repo_root" --open-web-dashboard false

cat <<'NEXT'

Done. Start a new Codex/Claude session and use this bootstrap prompt once:

Call serena.activate_project with the current repo path,
then serena.check_onboarding_performed and serena.initial_instructions.
For this session, prefer Serena tools for symbol search/references/edits
before broad file reads.
NEXT
