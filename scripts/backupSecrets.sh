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

if [[ "$SOURCE_ABS" == "/" ]]; then
  echo "backupSecrets: source directory cannot be the root directory" >&2
  exit 1
fi

ZIP_ARGS=(-r)
if [[ -n "${BACKUP_PASSWORD:-}" ]]; then
  ZIP_ARGS+=(-P "$BACKUP_PASSWORD")
elif [[ -t 0 && -t 1 ]]; then
  ZIP_ARGS+=(-e)
else
  echo "backupSecrets: encryption password required in non-interactive mode." >&2
  echo "Set BACKUP_PASSWORD or run interactively to enter a password prompt." >&2
  exit 1
fi

(
  cd "$SOURCE_PARENT"
  zip "${ZIP_ARGS[@]}" "$ARCHIVE_PATH" "$SOURCE_NAME" >/dev/null
)

echo "Created backup: $ARCHIVE_PATH"
