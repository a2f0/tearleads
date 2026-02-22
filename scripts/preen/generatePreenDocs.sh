#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: ./scripts/preen/generatePreenDocs.sh [--check]

Without arguments, rewrites both:
  - .claude/commands/preen.md
  - .codex/skills/preen/SKILL.md

With --check, verifies generated output matches files and exits non-zero on drift.
USAGE
  exit 2
}

MODE="write"
if [ "$#" -gt 1 ]; then
  usage
fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --check)
      MODE="check"
      ;;
    *)
      usage
      ;;
  esac
fi

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

REGISTRY_FILE="scripts/preen/registry.json"
if [ ! -f "$REGISTRY_FILE" ]; then
  echo "Error: missing $REGISTRY_FILE" >&2
  exit 1
fi

# Source helper functions (render_table_rows, render_category_array, etc.)
# shellcheck source=scripts/preen/generatePreenDocsHelpers.sh
source "scripts/preen/generatePreenDocsHelpers.sh"

# Source document rendering functions (render_document_part1, render_document_part2)
# shellcheck source=scripts/preen/generatePreenDocsContent.sh
source "scripts/preen/generatePreenDocsContent.sh"
# shellcheck source=scripts/preen/generatePreenDocsContentCont.sh
source "scripts/preen/generatePreenDocsContentCont.sh"

render_document() {
  local platform="$1"
  render_document_part1 "$platform"
  render_document_part2
}

CLAUDE_DOC_CONTENT="$(render_document claude)"
CODEX_DOC_CONTENT="$(render_document codex)"
GEMINI_DOC_CONTENT="$(render_document gemini)"

FAILED=0
check_or_write_file ".claude/commands/preen.md" "$CLAUDE_DOC_CONTENT" || FAILED=1
check_or_write_file ".codex/skills/preen/SKILL.md" "$CODEX_DOC_CONTENT" || FAILED=1
check_or_write_file ".gemini/skills/preen/SKILL.md" "$GEMINI_DOC_CONTENT" || FAILED=1

if [ "$MODE" = "check" ] && [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "preen docs are up to date"
