#!/usr/bin/env sh

set -eu

LINE_LIMIT=500
BYTE_LIMIT=20000

IGNORE_PATTERNS='^bun\.lock$
^\.gemini/
^\.serena/
^\.codex/
^\.turbo/
^node_modules/
^dist/
^build/
^pkg/
^playwright-report/
^test-results/
^packages/[^/]+/\.turbo/
^packages/[^/]+/dist/
^packages/[^/]+/build/
^packages/[^/]+/pkg/
^packages/[^/]+/test-results/
^packages/website/\.astro/
^packages/api/drizzle/meta/_journal\.json$
\.min\.js$
\.map$'

usage() {
  echo "Usage: $0 [--from-upstream] | --staged | --range <rev-range> | --all" >&2
  exit 2
}

mode=
range=

if [ "$#" -eq 0 ]; then
  mode=--from-upstream
elif [ "$#" -eq 1 ]; then
  case "$1" in
    --staged | --from-upstream | --all)
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

is_ignored() {
  path=$1
  old_ifs=$IFS
  IFS='
'

  for pattern in $IGNORE_PATTERNS; do
    if printf '%s\n' "$path" | grep -Eq "$pattern"; then
      IFS=$old_ifs
      return 0
    fi
  done

  IFS=$old_ifs
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

collect_files() {
  if [ "$mode" = "--staged" ]; then
    git diff --name-only --diff-filter=ACM --cached
    return
  fi

  if [ "$mode" = "--from-upstream" ]; then
    if base_ref=$(resolve_base_ref); then
      git diff --name-only --diff-filter=ACM "$base_ref..HEAD"
      return
    fi

    echo "Error: cannot determine base branch for comparison" >&2
    exit 1
  fi

  if [ "$mode" = "--range" ]; then
    git diff --name-only --diff-filter=ACM "$range"
    return
  fi

  if [ "$mode" = "--all" ]; then
    git ls-files
    return
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

  if is_ignored "$path"; then
    continue
  fi

  if file --mime "$path" | grep -q 'charset=binary'; then
    continue
  fi

  lines=$(wc -l <"$path" | xargs)
  bytes=$(wc -c <"$path" | xargs)

  if [ "$lines" -gt "$LINE_LIMIT" ] || [ "$bytes" -gt "$BYTE_LIMIT" ]; then
    bad_files="${bad_files}${path} (Lines: ${lines}, Bytes: ${bytes})
"
  fi
done

IFS=$old_ifs

if [ -z "$bad_files" ]; then
  exit 0
fi

echo "Error: The following files exceed the project's size limits (${LINE_LIMIT} lines or ${BYTE_LIMIT} bytes):" >&2
printf '%s' "$bad_files" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  printf '  - %s\n' "$line" >&2
done
echo "" >&2
echo "Split oversized files into smaller modules before committing. Existing oversized files should be reduced or left untouched until they can be refactored deliberately." >&2
exit 1
