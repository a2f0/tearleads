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

if ! command -v file >/dev/null 2>&1; then
  echo "Error: file is not installed. Please install file(1)." >&2
  exit 1
fi

is_allowed() {
  case "$1" in
    packages/client/public/v86/seabios.bin|packages/client/public/v86/v86.wasm|packages/client/public/v86/vgabios.bin)
      return 0
      ;;
  esac
  return 1
}

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=AM --cached
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
      git diff --name-only --diff-filter=AM "$upstream..HEAD"
      return
    fi

    empty_tree=$(git hash-object -t tree /dev/null)
    git diff --name-only --diff-filter=AM "$empty_tree" HEAD
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

  if is_allowed "$path"; then
    continue
  fi

  if file --mime "$path" | grep -q "charset=binary"; then
    bad_files+=("$path")
  fi

done

if [ "${#bad_files[@]}" -eq 0 ]; then
  exit 0
fi

echo "Error: binary files are not allowed in commits." >&2
printf '%s\n' "${bad_files[@]}" >&2
echo "If you must add a binary, update the allowlist in scripts/checkBinaryFiles.sh and document why." >&2
exit 1
