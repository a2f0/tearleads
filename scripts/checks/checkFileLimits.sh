#!/usr/bin/env sh
set -eu

LINE_LIMIT=500
BYTE_LIMIT=20000

IGNORE_PATTERNS='^pnpm-lock\.yaml$
^Cargo\.lock$
^ansible/vendor/
^package\.json$
^pnpm-workspace\.yaml$
^\.github/workflows/build\.yml$
^\.gemini/
^\.claude/
^\.codex/
^\.opencode/
^compliance/
^packages/website/src/data/releases\.json$
\.min\.js$
\.map$
^docs/[a-z-]+/terms-of-service\.md$'

usage() {
  echo "Usage: $0 --staged | --from-upstream | --all" >&2
  exit 2
}

if [ "$#" -ne 1 ]; then
  usage
fi

mode=$1

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

  if is_ignored "$path"; then
    continue
  fi

  if file --mime "$path" | grep -q 'charset=binary'; then
    continue
  fi

  lines=$(wc -l < "$path" | xargs)
  bytes=$(wc -c < "$path" | xargs)

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
echo "AGENT GUARDRAIL: These files exceed the project's size limits. As an expert AI agent, you must logically break these files apart into smaller, more modular components or modules. Follow existing project patterns for refactoring (e.g., extracting logic into separate files, splitting large components)." >&2
exit 1
