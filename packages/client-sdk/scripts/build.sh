#!/usr/bin/env sh
set -eu

rm -rf dist

tsc -p tsconfig.build.json
bun scripts/rewriteDistImports.ts
