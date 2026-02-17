#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-.secrets}"
DEFAULT_OUTPUT_DIR="$HOME/tearleads-secrets-backups"
OUTPUT_DIR="${2:-$DEFAULT_OUTPUT_DIR}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="secrets-backup-${TIMESTAMP}.zip"

if ! command -v zip >/dev/null 2>&1; then
  echo "backupSecrets: 'zip' command not found." >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "backupSecrets: source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

SOURCE_ABS="$(cd "$SOURCE_DIR" && pwd -P)"
SOURCE_PARENT="$(dirname "$SOURCE_ABS")"
SOURCE_NAME="$(basename "$SOURCE_ABS")"
OUTPUT_ABS="$(cd "$OUTPUT_DIR" && pwd -P)"
ARCHIVE_PATH="$OUTPUT_ABS/$ARCHIVE_NAME"

(
  cd "$SOURCE_PARENT"
  zip -r "$ARCHIVE_PATH" "$SOURCE_NAME" >/dev/null
)

echo "Created backup: $ARCHIVE_PATH"
