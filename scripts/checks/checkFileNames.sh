#!/usr/bin/env bash
set -euo pipefail

# Check TypeScript file naming conventions
# - React components (.tsx): PascalCase
# - TypeScript utilities (.ts): camelCase
# - Test files: match source file naming
# - Type definitions (.d.ts): camelCase
# - Excluded: skills directories, vite-env.d.ts, playwright-env.d.ts, electron-builder.config.ts

usage() {
  echo "Usage: $0 --staged | --from-upstream" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode="$1"

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=AM --cached
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    local base_branch

    if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
      base_branch="$upstream"
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      base_branch="origin/main"
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base_branch="main"
    else
      echo "Error: cannot determine base branch for comparison" >&2
      exit 1
    fi

    # Pre-push should enforce naming for newly introduced files while allowing
    # incremental edits to legacy kebab-case TypeScript files that predate this
    # guardrail. A dedicated migration can rename legacy files separately.
    git diff --name-only --diff-filter=A "$base_branch..HEAD"
    return
  fi

  usage
}

# Check if a filename uses kebab-case (has hyphens)
has_kebab_case() {
  local filename="$1"
  # Remove test/spec suffixes and extension to get base name
  local basename
  basename=$(basename "$filename")
  # Remove all extensions
  local name="${basename%%.*}"
  # Check for hyphens
  [[ "$name" == *-* ]]
}

# Check if file should be excluded
is_excluded() {
  local path="$1"

  # Exclude skill directories
  case "$path" in
    .claude/skills/*|.codex/skills/*) return 0 ;;
  esac

  # Exclude standard environment type files
  local basename
  basename=$(basename "$path")
  case "$basename" in
    vite-env.d.ts|playwright-env.d.ts|electron-builder.config.ts) return 0 ;;
  esac

  return 1
}

mapfile -t files < <(collect_files)

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

bad_files=()

for path in "${files[@]}"; do
  if [ ! -f "$path" ]; then
    continue
  fi

  # Only check TypeScript files
  case "$path" in
    *.ts|*.tsx)
      # Skip excluded paths
      if is_excluded "$path"; then
        continue
      fi

      # Check for kebab-case
      if has_kebab_case "$path"; then
        bad_files+=("$path")
      fi
      ;;
  esac
done

if [ "${#bad_files[@]}" -eq 0 ]; then
  exit 0
fi

echo "Error: TypeScript files must not use kebab-case naming." >&2
echo "Use camelCase for utilities (.ts) and PascalCase for components (.tsx)." >&2
echo "" >&2
echo "Files with invalid naming:" >&2
printf '  %s\n' "${bad_files[@]}" >&2
echo "" >&2
exit 1
