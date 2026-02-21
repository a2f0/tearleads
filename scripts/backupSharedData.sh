#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SOURCE_DIRS=("$REPO_ROOT/.secrets" "$REPO_ROOT/.test_files")
DEFAULT_OUTPUT_DIR="$HOME/tearleads-backups"
OUTPUT_DIR="$DEFAULT_OUTPUT_DIR"
PASSWORD=""
NO_PASSWORD=false
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="shared-data-backup-${TIMESTAMP}.zip"

usage() {
  echo "Usage: backupSharedData.sh [output_dir] [--password <password>] [--no-password]"
}

output_dir_set=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password)
      if [[ $# -lt 2 ]]; then
        echo "backupSharedData: missing value for --password" >&2
        usage >&2
        exit 1
      fi
      PASSWORD="$2"
      shift 2
      ;;
    --password=*)
      PASSWORD="${1#*=}"
      shift
      ;;
    --no-password)
      NO_PASSWORD=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "backupSharedData: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ "$output_dir_set" -eq 1 ]]; then
        echo "backupSharedData: too many positional arguments" >&2
        usage >&2
        exit 1
      fi
      OUTPUT_DIR="$1"
      output_dir_set=1
      shift
      ;;
  esac
done

if ! command -v zip >/dev/null 2>&1; then
  echo "backupSharedData: 'zip' command not found." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

OUTPUT_ABS="$(cd "$OUTPUT_DIR" && pwd -P)"
ARCHIVE_PATH="$OUTPUT_ABS/$ARCHIVE_NAME"

for source_dir in "${SOURCE_DIRS[@]}"; do
  if [[ ! -d "$source_dir" ]]; then
    echo "backupSharedData: source directory not found: $source_dir" >&2
    exit 1
  fi

  source_abs="$(cd "$source_dir" && pwd -P)"
  if [[ "$source_abs" == "/" ]]; then
    echo "backupSharedData: source directory cannot be the root directory: $source_dir" >&2
    exit 1
  fi
done

ZIP_ARGS=(-r)
if [[ -n "$PASSWORD" ]]; then
  ZIP_ARGS+=(-P "$PASSWORD")
elif [[ "$NO_PASSWORD" == "true" ]]; then
  : # No encryption
elif [[ -t 0 && -t 1 ]]; then
  ZIP_ARGS+=(-e)
else
  : # Non-interactive without password - create unencrypted backup
fi

# Zip from repo root to maintain relative paths in archive
# Symlinks are followed by default (zip dereferences them)
(cd "$REPO_ROOT" && zip "${ZIP_ARGS[@]}" "$ARCHIVE_PATH" .secrets .test_files >/dev/null)

echo "Created backup: $ARCHIVE_PATH"
echo "Backed up directories: .secrets .test_files"
