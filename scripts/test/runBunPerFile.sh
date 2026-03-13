#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF'
Usage: runBunPerFile.sh [--preload <path>] [--root <path>] [--timeout <secs>]

Runs Bun tests one file at a time to avoid cross-file mock leakage.
Test files are discovered under <root> (default: src) using:
  - *.test.ts
  - *.test.tsx

Options:
  --preload <path>    Preload script for bun test
  --root <path>       Root directory to search for test files (default: src)
  --timeout <secs>    Per-file timeout in seconds; timed-out files are skipped
EOF
}

preload=""
search_root="src"
per_file_timeout=""

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
    --timeout)
      shift
      if [ "$#" -eq 0 ]; then
        echo "runBunPerFile: missing value for --timeout" >&2
        exit 2
      fi
      per_file_timeout="$1"
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

passed=0
failed=0
skipped=0

while IFS= read -r test_file; do
  if [ -z "$test_file" ]; then
    continue
  fi

  echo "runBunPerFile: $test_file"

  if [ -n "$per_file_timeout" ]; then
    if [ -n "$preload" ]; then
      if timeout "$per_file_timeout" bun test --preload "$preload" "$test_file"; then
        passed=$((passed + 1))
      else
        ec=$?
        if [ "$ec" -eq 124 ]; then
          echo "runBunPerFile: SKIP (timeout) $test_file" >&2
          skipped=$((skipped + 1))
        else
          echo "runBunPerFile: FAIL $test_file" >&2
          failed=$((failed + 1))
        fi
      fi
    else
      if timeout "$per_file_timeout" bun test "$test_file"; then
        passed=$((passed + 1))
      else
        ec=$?
        if [ "$ec" -eq 124 ]; then
          echo "runBunPerFile: SKIP (timeout) $test_file" >&2
          skipped=$((skipped + 1))
        else
          echo "runBunPerFile: FAIL $test_file" >&2
          failed=$((failed + 1))
        fi
      fi
    fi
  else
    if [ -n "$preload" ]; then
      bun test --preload "$preload" "$test_file"
    else
      bun test "$test_file"
    fi
    passed=$((passed + 1))
  fi
done < "$temp_file"

total=$((passed + failed + skipped))

if [ -n "$per_file_timeout" ]; then
  echo "runBunPerFile: $passed passed, $failed failed, $skipped skipped (timeout) / $total total"
  if [ "$failed" -gt 0 ]; then
    exit 1
  fi
fi
