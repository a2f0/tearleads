#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: runBunPerFile.sh [--preload <path>] [--root <path>]

Runs Bun tests one file at a time to avoid cross-file mock leakage.
Test files are discovered under <root> (default: src) using:
  - *.test.ts
  - *.test.tsx
EOF
}

preload=""
search_root="src"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --preload)
      shift
      if [ "$#" -eq 0 ]; then
        echo "runBunPerFile: missing value for --preload" >&2
        exit 2
      fi
      preload="$1"
      ;;
    --root)
      shift
      if [ "$#" -eq 0 ]; then
        echo "runBunPerFile: missing value for --root" >&2
        exit 2
      fi
      search_root="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "runBunPerFile: unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if ! command -v bun >/dev/null 2>&1; then
  echo "runBunPerFile: bun is required but was not found in PATH" >&2
  exit 1
fi

if ! [ -d "$search_root" ]; then
  echo "runBunPerFile: root path '$search_root' does not exist" >&2
  exit 1
fi

if command -v rg >/dev/null 2>&1; then
  discovered_files=$(rg --files "$search_root" \
    -g '*.test.ts' \
    -g '*.test.tsx' 2>/dev/null || true)
else
  discovered_files=$(find "$search_root" -type f \
    \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null || true)
fi

test_files=$(
  printf '%s\n' "$discovered_files" | sed '/^$/d' | LC_ALL=C sort
)

if [ -z "$test_files" ]; then
  echo "runBunPerFile: no test files found under '$search_root'" >&2
  exit 0
fi

temp_file=$(mktemp "${TMPDIR:-/tmp}/runBunPerFile.XXXXXX")
trap 'rm -f "$temp_file"' EXIT HUP INT TERM
printf '%s\n' "$test_files" > "$temp_file"

while IFS= read -r test_file; do
  if [ -z "$test_file" ]; then
    continue
  fi

  echo "runBunPerFile: $test_file"
  if [ -n "$preload" ]; then
    bun test --preload "$preload" "$test_file"
  else
    bun test "$test_file"
  fi
done < "$temp_file"
