#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --staged | --from-upstream | --all" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode="$1"

collect_control_maps() {
  case "$mode" in
    --all)
      rg --files compliance | rg 'technical-controls/.+control-map\.md$'
      ;;
    --staged)
      git diff --name-only --diff-filter=AM --cached | rg '^compliance/.+/technical-controls/.+control-map\.md$' || true
      ;;
    --from-upstream)
      if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
        git diff --name-only --diff-filter=AM "$upstream..HEAD" | rg '^compliance/.+/technical-controls/.+control-map\.md$' || true
      elif git rev-parse --verify origin/main >/dev/null 2>&1; then
        git diff --name-only --diff-filter=AM "origin/main..HEAD" | rg '^compliance/.+/technical-controls/.+control-map\.md$' || true
      elif git rev-parse --verify main >/dev/null 2>&1; then
        git diff --name-only --diff-filter=AM "main..HEAD" | rg '^compliance/.+/technical-controls/.+control-map\.md$' || true
      else
        echo "Error: cannot determine base branch for comparison" >&2
        exit 1
      fi
      ;;
    *)
      usage
      ;;
  esac
}

mapfile -t files < <(collect_control_maps)

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

errors=()

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then
    continue
  fi

  section="$(awk '
    /^## Sentinel Controls$/ { in_section=1; next }
    /^## / && in_section { exit }
    in_section { print }
  ' "$file")"

  if [ -z "$section" ]; then
    continue
  fi

  while IFS= read -r target; do
    [ -z "$target" ] && continue

    if [[ "$target" =~ ^(https?://|mailto:|#) ]]; then
      continue
    fi

    if [[ "$target" = /* ]]; then
      errors+=("$file: sentinel link target must be relative: $target")
      continue
    fi

    base_dir="$(dirname "$file")"
    if [ ! -e "$base_dir/$target" ]; then
      errors+=("$file: broken sentinel link target: $target")
    fi
  done < <(printf '%s\n' "$section" | perl -nE 'while (/\[[^\]]+\]\(([^)]+)\)/g) { say $1 }')

  while IFS= read -r token; do
    [ -z "$token" ] && continue

    if [[ "$token" =~ [[:space:]] ]]; then
      continue
    fi

    if [[ "$token" == /* ]]; then
      continue
    fi

    if [[ "$token" == *"*"* ]]; then
      continue
    fi

    if [ -e "$token" ]; then
      errors+=("$file: sentinel evidence path exists but is not a markdown link: $token")
    fi
  done < <(printf '%s\n' "$section" | perl -nE 'while (/(?<!\[)`([^`\n]+\/[^`\n]+)`(?!\]\()/g) { say $1 }')
done

if [ "${#errors[@]}" -gt 0 ]; then
  echo "Error: invalid sentinel markdown evidence links detected:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  exit 1
fi
