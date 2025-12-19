#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

echo "==> Building the app..."
pnpm build

echo "==> Running Playwright tests..."
pnpm test:e2e
