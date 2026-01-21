#!/bin/sh
set -e

exec journalctl -u rapid-api.service -f --no-pager "$@"
