#!/usr/bin/env bash
set -euo pipefail

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
    # Fallback for new branches without upstream: compare against origin/main
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      base_branch="origin/main"
    # Last resort: compare against local main
    elif git rev-parse --verify main >/dev/null 2>&1; then
      base_branch="main"
    else
      echo "Error: cannot determine base branch for comparison" >&2
      exit 1
    fi

    git diff --name-only --diff-filter=AM "$base_branch..HEAD"
    return
  fi

  usage
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

  case "$path" in
    *.js|*.mjs|*.cjs|*.jsx)
      bad_files+=("$path")
      ;;
  esac
done

if [ "${#bad_files[@]}" -eq 0 ]; then
  exit 0
fi

echo "Error: plain JavaScript files are not allowed in commits." >&2
echo "Use TypeScript files (.ts/.tsx) instead." >&2
printf '%s\n' "${bad_files[@]}" >&2
exit 1
