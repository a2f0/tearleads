#!/bin/bash
# Generate CSP hashes for inline styles in the built website
# Run this after `pnpm build` to get the hashes for the nginx CSP

set -euo pipefail

DIST_DIR="$(dirname "$0")/../dist"

if [ ! -d "$DIST_DIR" ]; then
  echo "Error: dist directory not found. Run 'pnpm build' first." >&2
  exit 1
fi

echo "Extracting inline styles from built HTML..."
echo ""

# Extract unique style attribute values and compute SHA-256 hashes
styles=$(grep -roh 'style="[^"]*"' "$DIST_DIR" | sed 's/style="//;s/"$//' | sort -u)

echo "Found inline styles:"
echo "===================="

hashes=""
while IFS= read -r style; do
  if [ -n "$style" ]; then
    hash=$(echo -n "$style" | openssl dgst -sha256 -binary | base64)
    echo "Style: $style"
    echo "Hash:  'sha256-$hash'"
    echo ""
    hashes="$hashes 'sha256-$hash'"
  fi
done <<< "$styles"

echo ""
echo "CSP style-src directive:"
echo "========================"
echo "style-src 'self' 'unsafe-hashes'$hashes;"
