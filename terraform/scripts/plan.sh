#!/bin/sh
set -eu
terraform -chdir="$(dirname "$0")/.." plan "$@"
