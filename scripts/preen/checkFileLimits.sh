#!/usr/bin/env bash
set -euo pipefail

# Configuration
LINE_LIMIT=500
BYTE_LIMIT=20000

# Files to ignore (regex patterns)
# Documentation and AI skill definition directories are ignored as they
# are often automatically generated or contain large meta-logic descriptions.
IGNORE_PATTERNS=(
  "^pnpm-lock\.yaml$"
  "^ansible/vendor/"
  "^package\.json$"
  "^pnpm-workspace\.yaml$"
  "^\.github/workflows/build\.yml$"
  "^\.gemini/"
  "^\.claude/"
  "^\.codex/"
  "^\.opencode/"
  "^compliance/"
  "^packages/website/src/data/releases\.json$"
  "\.min\.js$"
  "\.map$"
  # Legal documents: terms of service translations cannot be split
  "^docs/[a-z]{2}/terms-of-service\.md$"
)

usage() {
  echo "Usage: $0 --staged | --from-upstream | --all" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode="$1"

is_ignored() {
  local path="$1"
  for pattern in "${IGNORE_PATTERNS[@]}"; do
    if [[ "$path" =~ $pattern ]]; then
      return 0
    fi
  done
  return 1
}

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=AM --cached
    return
  fi

  if [ "$mode" = "--all" ]; then
    git ls-files
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
      git diff --name-only --diff-filter=AM "$upstream..HEAD"
      return
    fi

    # Fallback for new branches without upstream: compare against origin/main
    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      git diff --name-only --diff-filter=AM "origin/main..HEAD"
      return
    fi

    # Last resort: compare against local main
    if git rev-parse --verify main >/dev/null 2>&1; then
      git diff --name-only --diff-filter=AM "main..HEAD"
      return
    fi

    echo "Error: cannot determine base branch for comparison" >&2
    exit 1
  fi

  usage
}

mapfile -t files < <(collect_files)

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

bad_files=()

for path in "${files[@]}"; do
  # Skip if file was deleted in the meantime or is not a regular file
  if [ ! -f "$path" ]; then
    continue
  fi

  if is_ignored "$path"; then
    continue
  fi

  # Skip binary files as they are handled by checkBinaryFiles.sh
  if file --mime "$path" | grep -q "charset=binary"; then
    continue
  fi

  lines=$(wc -l < "$path" | xargs)
  bytes=$(wc -c < "$path" | xargs)

  if [ "$lines" -gt "$LINE_LIMIT" ] || [ "$bytes" -gt "$BYTE_LIMIT" ]; then
    bad_files+=("$path (Lines: $lines, Bytes: $bytes)")
  fi
done

if [ "${#bad_files[@]}" -eq 0 ]; then
  exit 0
fi

echo "Error: The following files exceed the project's size limits ($LINE_LIMIT lines or $BYTE_LIMIT bytes):" >&2
printf '  - %s
' "${bad_files[@]}" >&2
echo "" >&2
echo "AGENT GUARDRAIL: These files exceed the project's size limits. As an expert AI agent, you must logically break these files apart into smaller, more modular components or modules. Follow existing project patterns for refactoring (e.g., extracting logic into separate files, splitting large components)." >&2
exit 1
