#!/usr/bin/env sh
set -eu

# Run from the package root so the relative paths below resolve regardless of the
# caller's working directory.
cd "$(dirname "$0")/.."

# Clear the incremental build cache alongside dist; it lives at the package root
# (outside dist so it never ships in the published tarball), so a bare
# `rm -rf dist` would otherwise leave tsc thinking the deleted output is current.
rm -rf dist tsconfig.build.tsbuildinfo

tsc -p tsconfig.build.json
bun scripts/rewriteDistImports.ts
