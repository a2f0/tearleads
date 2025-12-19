#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

pnpm build && pnpm exec cap sync ios && pnpm exec cap run ios --target-name "iPhone 16"
