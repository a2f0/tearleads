#!/bin/sh
set -e

exec journalctl -u tearleads-api.service -f --no-pager "$@"
