#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: $0 --staged | --from-upstream" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode=$1

if ! command -v file >/dev/null 2>&1; then
  echo "Error: file is not installed. Please install file(1)." >&2
  exit 1
fi

is_allowed() {
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

    if git rev-parse --verify origin/main >/dev/null 2>&1; then
      git diff --name-only --diff-filter=AM "origin/main..HEAD"
      return
    fi

    if git rev-parse --verify main >/dev/null 2>&1; then
      git diff --name-only --diff-filter=AM "main..HEAD"
      return
    fi

    echo "Error: cannot determine base branch for comparison" >&2
    exit 1
  fi

  usage
}

files=$(collect_files)

if [ -z "$files" ]; then
  exit 0
fi

bad_files=''
old_ifs=$IFS
IFS='
'

for path in $files; do
  if [ ! -f "$path" ]; then
    continue
  fi

  if is_allowed "$path"; then
    continue
  fi

  if file --mime "$path" | grep -q 'charset=binary'; then
    bad_files="${bad_files}${path}
"
  fi
done

IFS=$old_ifs

if [ -z "$bad_files" ]; then
  exit 0
fi

echo "Error: binary files are not allowed in commits." >&2
printf '%s' "$bad_files" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '%s\n' "$line" >&2
done
echo "If you must add a binary, update the allowlist in scripts/checks/checkBinaryFiles.sh and document why." >&2
exit 1
