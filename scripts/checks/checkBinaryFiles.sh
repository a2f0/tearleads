#!/usr/bin/env sh

set -eu

usage() {
  echo "Usage: $0 --staged | --from-upstream | --range <rev-range>" >&2
  exit 2
}

mode=
range=

if [ "$#" -eq 1 ]; then
  case "$1" in
    --staged | --from-upstream)
      mode=$1
      ;;
    --range=*)
      mode=--range
      range=${1#--range=}
      [ -n "$range" ] || usage
      ;;
    *)
      usage
      ;;
  esac
elif [ "$#" -eq 2 ] && [ "$1" = "--range" ]; then
  mode=--range
  range=$2
  [ -n "$range" ] || usage
else
  usage
fi

is_allowed() {
  path=$1

  case "$path" in
    # Add narrowly-scoped exceptions here only with a reason.
    "")
      return 0
      ;;
  esac

  return 1
}

resolve_base_ref() {
  if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
    printf '%s\n' "$upstream"
    return 0
  fi

  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    base_ref="origin/$GITHUB_BASE_REF"

    if ! git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
      git fetch --depth=1 origin \
        "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF" >/dev/null 2>&1 || true
    fi

    if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
      printf '%s\n' "$base_ref"
      return 0
    fi
  fi

  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    printf '%s\n' 'origin/main'
    return 0
  fi

  if git rev-parse --verify main >/dev/null 2>&1; then
    printf '%s\n' 'main'
    return 0
  fi

  return 1
}

collect_numstat() {
  if [ "$mode" = "--staged" ]; then
    git diff --cached --numstat --diff-filter=ACM
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    if base_ref=$(resolve_base_ref); then
      git diff --numstat --diff-filter=ACM "$base_ref..HEAD"
      return
    fi

    echo "Error: cannot determine base branch for comparison" >&2
    exit 1
  fi

  if [ "$mode" = "--range" ]; then
    git diff --numstat --diff-filter=ACM "$range"
    return
  fi

  usage
}

numstat_file=$(mktemp)

trap 'rm -f "$numstat_file"' EXIT HUP INT TERM

collect_numstat >"$numstat_file"

bad_files=''

while IFS='	' read -r added deleted path; do
  if [ -z "${path:-}" ]; then
    continue
  fi

  if is_allowed "$path"; then
    continue
  fi

  if [ "$added" = "-" ] && [ "$deleted" = "-" ]; then
    bad_files="${bad_files}${path}
"
  fi
done <"$numstat_file"

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
