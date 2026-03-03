#!/usr/bin/env bash
set -euo pipefail

# Verifies that the pdfjs-dist version declared in packages/client/package.json
# matches the version that react-pdf expects (from pnpm-lock.yaml).
#
# react-pdf pins pdfjs-dist to an exact version. If our direct pdfjs-dist
# dependency drifts, the PDF worker version mismatches and PDF loading breaks.
#
# Usage:
#   ./scripts/checks/checkPdfVersionParity.sh

REPO_ROOT="$(git rev-parse --show-toplevel)"
CLIENT_PKG="$REPO_ROOT/packages/client/package.json"
LOCKFILE="$REPO_ROOT/pnpm-lock.yaml"

if [ ! -f "$CLIENT_PKG" ]; then
  echo "Error: $CLIENT_PKG not found" >&2
  exit 1
fi

if [ ! -f "$LOCKFILE" ]; then
  echo "Error: $LOCKFILE not found" >&2
  exit 1
fi

# Extract the declared pdfjs-dist version from client package.json
DECLARED_PDFJS=$(grep -o '"pdfjs-dist": *"[^"]*"' "$CLIENT_PKG" | grep -o '[0-9][^"]*')
if [ -z "$DECLARED_PDFJS" ]; then
  echo "Error: pdfjs-dist not found in $CLIENT_PKG" >&2
  exit 1
fi

# Extract the react-pdf version from client package.json
DECLARED_REACT_PDF=$(grep -o '"react-pdf": *"[^"]*"' "$CLIENT_PKG" | grep -o '[0-9][^"]*')
if [ -z "$DECLARED_REACT_PDF" ]; then
  echo "Error: react-pdf not found in $CLIENT_PKG" >&2
  exit 1
fi

# Find what pdfjs-dist version react-pdf resolves to in the lockfile.
# Look for the react-pdf snapshot section and extract pdfjs-dist from its dependencies.
REACT_PDF_PDFJS=$(awk "
  /^  react-pdf@${DECLARED_REACT_PDF}\\(/ { found=1; next }
  found && /^  [^ ]/ { found=0 }
  found && /pdfjs-dist:/ { gsub(/.*pdfjs-dist: */, \"\"); gsub(/[[:space:]]/, \"\"); print; exit }
" "$LOCKFILE")

if [ -z "$REACT_PDF_PDFJS" ]; then
  echo "Warning: Could not determine pdfjs-dist version from react-pdf in lockfile." >&2
  echo "Skipping parity check (lockfile may need regeneration)." >&2
  exit 0
fi

if [ "$DECLARED_PDFJS" != "$REACT_PDF_PDFJS" ]; then
  echo "Error: pdfjs-dist version mismatch!" >&2
  echo "  packages/client/package.json declares pdfjs-dist@$DECLARED_PDFJS" >&2
  echo "  react-pdf@$DECLARED_REACT_PDF requires pdfjs-dist@$REACT_PDF_PDFJS" >&2
  echo "" >&2
  echo "These versions must match. react-pdf pins pdfjs-dist to an exact version;" >&2
  echo "a mismatch causes the PDF worker to fail (PDF loading hangs)." >&2
  echo "" >&2
  echo "Fix: update pdfjs-dist in packages/client/package.json to $REACT_PDF_PDFJS" >&2
  echo "     or update both react-pdf and pdfjs-dist together." >&2
  exit 1
fi

echo "PDF version parity OK: pdfjs-dist@$DECLARED_PDFJS matches react-pdf@$DECLARED_REACT_PDF expectation."
