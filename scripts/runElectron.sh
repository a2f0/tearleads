#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

pnpm electron:dev
