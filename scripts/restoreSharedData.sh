#!/usr/bin/env bash
set -euo pipefail

TARGET_DIRS=(".secrets" ".test_files")
DEFAULT_BACKUP_DIR="$HOME/tearleads-backups"
BACKUP_DIR="$DEFAULT_BACKUP_DIR"
PASSWORD=""
BACKUP_FILE=""

usage() {
  echo "Usage: restoreSharedData.sh [backup_dir] [--password <password>] [--file <backup_file>]"
  echo ""
  echo "Options:"
  echo "  --password <password>  Password to decrypt the backup"
  echo "  --file <backup_file>   Specific backup file to restore (default: most recent)"
  echo "  -h, --help             Show this help message"
}

backup_dir_set=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password)
      if [[ $# -lt 2 ]]; then
        echo "restoreSharedData: missing value for --password" >&2
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
    --file)
      if [[ $# -lt 2 ]]; then
        echo "restoreSharedData: missing value for --file" >&2
        usage >&2
        exit 1
      fi
      BACKUP_FILE="$2"
      shift 2
      ;;
    --file=*)
      BACKUP_FILE="${1#*=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "restoreSharedData: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ "$backup_dir_set" -eq 1 ]]; then
        echo "restoreSharedData: too many positional arguments" >&2
        usage >&2
        exit 1
      fi
      BACKUP_DIR="$1"
      backup_dir_set=1
      shift
      ;;
  esac
done

if ! command -v unzip >/dev/null 2>&1; then
  echo "restoreSharedData: 'unzip' command not found." >&2
  exit 1
fi

if [[ ! -d "$BACKUP_DIR" ]]; then
  echo "restoreSharedData: backup directory not found: $BACKUP_DIR" >&2
  exit 1
fi

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name 'shared-data-backup-*.zip' -type f | sort -r | head -n 1)
  if [[ -z "$BACKUP_FILE" ]]; then
    echo "restoreSharedData: no backup files found in $BACKUP_DIR" >&2
    exit 1
  fi
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "restoreSharedData: backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

UNZIP_ARGS=(-o)
if [[ -n "$PASSWORD" ]]; then
  UNZIP_ARGS+=(-P "$PASSWORD")
fi

echo "Restoring from: $BACKUP_FILE"

# Check if target directories are symlinks - if so, extract to temp and copy to targets
NEEDS_SYMLINK_HANDLING=0
for target_dir in "${TARGET_DIRS[@]}"; do
  if [[ -L "$target_dir" ]]; then
    NEEDS_SYMLINK_HANDLING=1
    break
  fi
done

if [[ "$NEEDS_SYMLINK_HANDLING" -eq 1 ]]; then
  TEMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_DIR"' EXIT

  unzip "${UNZIP_ARGS[@]}" "$BACKUP_FILE" -d "$TEMP_DIR" >/dev/null

  for target_dir in "${TARGET_DIRS[@]}"; do
    if [[ -L "$target_dir" ]]; then
      REAL_TARGET=$(readlink -f "$target_dir" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$target_dir'))")
      mkdir -p "$REAL_TARGET"
      if [[ -d "$TEMP_DIR/$target_dir" ]]; then
        cp -R "$TEMP_DIR/$target_dir/." "$REAL_TARGET"/
        echo "Restored $target_dir -> $REAL_TARGET"
      fi
    elif [[ -d "$TEMP_DIR/$target_dir" ]]; then
      mkdir -p "$target_dir"
      cp -R "$TEMP_DIR/$target_dir/." "$target_dir"/
      echo "Restored $target_dir"
    fi
  done
else
  unzip "${UNZIP_ARGS[@]}" "$BACKUP_FILE" >/dev/null
  echo "Restored directories: ${TARGET_DIRS[*]}"
fi
