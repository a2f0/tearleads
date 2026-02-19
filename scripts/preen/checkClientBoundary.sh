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
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      base_branch="origin/main"
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

violations=()

import_pattern="(import[[:space:]]*\\(|require[[:space:]]*\\(|from[[:space:]]+)[[:space:]]*['\"][^'\"]*(@tearleads/client|packages/client/)"

search_with_line_numbers() {
  local pattern="$1"
  local file="$2"

  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$file" || true
    return
  fi

  grep -En "$pattern" "$file" || true
}

for path in "${files[@]}"; do
  if [ ! -f "$path" ]; then
    continue
  fi

  case "$path" in
    packages/client/*)
      continue
      ;;
  esac

  if [[ "$path" =~ ^packages/[^/]+/package\.json$ ]]; then
    if [ "$path" != "packages/client/package.json" ] && search_with_line_numbers '"@tearleads/client"[[:space:]]*:' "$path" >/dev/null; then
      violations+=("$path: package dependency on @tearleads/client is not allowed")
    fi
    continue
  fi

  case "$path" in
    *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs)
      while IFS= read -r line; do
        violations+=("$path:$line")
      done < <(search_with_line_numbers "$import_pattern" "$path")
      ;;
  esac
done

if [ "${#violations[@]}" -eq 0 ]; then
  exit 0
fi

echo "Error: packages outside packages/client must not import or depend on the client app." >&2
echo "Move shared logic to reusable packages (for example @tearleads/window-manager or @tearleads/ui)." >&2
printf '%s\n' "${violations[@]}" >&2
exit 1
