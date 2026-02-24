#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

cd "$REPO_ROOT"

set -- --filter @tearleads/api cli vfs-crdt-compaction

if [ "${VFS_CRDT_COMPACTION_JSON_OUTPUT:-1}" = "1" ]; then
  set -- "$@" --json
fi

if [ "${VFS_CRDT_COMPACTION_EXECUTE:-0}" = "1" ]; then
  set -- "$@" --execute
fi

if [ -n "${VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS:-}" ]; then
  set -- "$@" --hot-retention-days "${VFS_CRDT_COMPACTION_HOT_RETENTION_DAYS}"
fi

if [ -n "${VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS:-}" ]; then
  set -- "$@" --inactive-client-days "${VFS_CRDT_COMPACTION_INACTIVE_CLIENT_DAYS}"
fi

if [ -n "${VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS:-}" ]; then
  set -- "$@" --safety-buffer-hours "${VFS_CRDT_COMPACTION_SAFETY_BUFFER_HOURS}"
fi

if [ -n "${VFS_CRDT_COMPACTION_CLIENT_PREFIX:-}" ]; then
  set -- "$@" --client-prefix "${VFS_CRDT_COMPACTION_CLIENT_PREFIX}"
fi

if [ -n "${VFS_CRDT_COMPACTION_MAX_DELETE_ROWS:-}" ]; then
  set -- "$@" --max-delete-rows "${VFS_CRDT_COMPACTION_MAX_DELETE_ROWS}"
fi

exec pnpm "$@"
