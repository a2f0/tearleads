#!/bin/sh
set -e

exec journalctl -u tearleads-smtp-listener.service -f --no-pager "$@"
