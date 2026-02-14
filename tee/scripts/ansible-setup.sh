#!/bin/sh
set -eu

"$(dirname "$0")"/../ansible/scripts/setup.sh "$@"
