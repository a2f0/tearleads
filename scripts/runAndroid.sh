#!/bin/sh
set -eu

cd "$(dirname "$0")/../packages/client"

pnpm build && pnpm exec cap sync android && pnpm exec cap run android --target "Maestro_Pixel_6_API_33_1"
