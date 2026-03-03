#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../packages/client"
pnpm screenshots "$@"
