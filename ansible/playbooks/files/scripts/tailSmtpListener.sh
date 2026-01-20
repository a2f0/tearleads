#!/bin/sh
set -e

exec journalctl -u rapid-smtp-listener.service -f --no-pager "$@"
