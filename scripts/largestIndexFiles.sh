#!/usr/bin/env bash
# Lists the largest files tracked in the git index, sorted by size descending.
# Usage: ./scripts/largestIndexFiles.sh [N]
#   N = number of files to show (default: 30)

set -euo pipefail

LIMIT="${1:-30}"

tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

git ls-files -s \
  | while IFS=$'\t' read -r meta path; do
      if [ -z "$meta" ]; then continue; fi
      read -r _ object_hash _ <<< "$meta"
      size=$(git cat-file -s "$object_hash")
      printf '%d\t%s\n' "$size" "$path"
    done > "$tmpfile"

sort -t$'\t' -k1 -rn "$tmpfile" \
  | awk -F'\t' -v limit="$LIMIT" '
    NR <= limit {
      size = $1
      file = $2
      if (size >= 1024*1024)
        printf "%8.1f MB  %s\n", size / (1024*1024), file
      else if (size >= 1024)
        printf "%8.1f KB  %s\n", size / 1024, file
      else
        printf "%8d B   %s\n", size, file
    }'
