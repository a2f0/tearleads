#!/bin/sh
# Sync Node/Electron and Android SDK versions with upstream metadata.
#
# Default mode is check-only; use --apply to write file changes.
set -eu

APPLY=0
SKIP_NODE=0
SKIP_ANDROID=0
MAX_ANDROID_JUMP="${MAX_ANDROID_API_JUMP:-1}"
ALLOW_RUNTIME_MISMATCH="${TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH:-0}"

usage() {
  cat <<'EOF' >&2
Usage: ./scripts/syncToolchainVersions.sh [options]

Options:
  --apply                  Write updates to files.
  --check                  Check only (default).
  --skip-node              Skip Electron -> Node alignment.
  --skip-android           Skip Android SDK alignment.
  --max-android-jump <n>   Max allowed API-level bump in one run (default: 1).
  -h, --help               Show this help message.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1
      ;;
    --check)
      APPLY=0
      ;;
    --skip-node)
      SKIP_NODE=1
      ;;
    --skip-android)
      SKIP_ANDROID=1
      ;;
    --max-android-jump)
      shift
      if [ $# -eq 0 ]; then
        echo "Missing value for --max-android-jump" >&2
        exit 2
      fi
      MAX_ANDROID_JUMP="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

case "$MAX_ANDROID_JUMP" in
  ''|*[!0-9]*)
    echo "Invalid --max-android-jump: $MAX_ANDROID_JUMP" >&2
    exit 2
    ;;
esac

case "$ALLOW_RUNTIME_MISMATCH" in
  0|1) ;;
  *)
    echo "Invalid TOOLCHAIN_SYNC_ALLOW_RUNTIME_MISMATCH: $ALLOW_RUNTIME_MISMATCH" >&2
    exit 2
    ;;
esac

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

CHANGED=0
NODE_RUNTIME_MISMATCH=0
NODE_MAJOR_FOR_ANSIBLE=""

log() {
  printf '%s\n' "$*" >&2
}

sync_node() {
  ROOT_PKG="$REPO_ROOT/package.json"
  CLIENT_PKG="$REPO_ROOT/packages/client/package.json"
  NVMRC="$REPO_ROOT/.nvmrc"

  if [ ! -f "$ROOT_PKG" ] || [ ! -f "$CLIENT_PKG" ] || [ ! -f "$NVMRC" ]; then
    log "Toolchain sync (node): skipped; missing package.json/.nvmrc files."
    return
  fi

  if ! command -v jq >/dev/null 2>&1; then
    log "Toolchain sync (node): skipped; jq is not available."
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log "Toolchain sync (node): skipped; curl is not available."
    return
  fi

  ELECTRON_VERSION=$(jq -r '.devDependencies.electron // .dependencies.electron // empty' "$CLIENT_PKG" 2>/dev/null || true)
  if [ -z "$ELECTRON_VERSION" ]; then
    log "Toolchain sync (node): skipped; Electron version not found in packages/client/package.json."
    return
  fi

  RELEASES_JSON=$(curl -fsSL https://releases.electronjs.org/releases.json 2>/dev/null || true)
  if [ -z "$RELEASES_JSON" ]; then
    log "Toolchain sync (node): skipped; unable to fetch Electron release metadata."
    return
  fi

  ELECTRON_NODE=$(printf '%s' "$RELEASES_JSON" \
    | jq -r --arg electron "$ELECTRON_VERSION" \
      '[.[] | select(.version == $electron and (.node // "") != "")][0].node // empty' 2>/dev/null || true)
  if [ -z "$ELECTRON_NODE" ]; then
    log "Toolchain sync (node): skipped; no Node mapping found for Electron $ELECTRON_VERSION."
    return
  fi

  DESIRED_NVM="v$ELECTRON_NODE"
  NODE_MAJOR=${ELECTRON_NODE%%.*}
  NEXT_NODE_MAJOR=$((NODE_MAJOR + 1))
  DESIRED_ENGINE_RANGE=">=${ELECTRON_NODE} <${NEXT_NODE_MAJOR}"

  CURRENT_NVM=$(tr -d ' \t\r\n' < "$NVMRC" 2>/dev/null || true)
  CURRENT_ENGINE_RANGE=$(jq -r '.engines.node // empty' "$ROOT_PKG" 2>/dev/null || true)

  NEEDS_NVM_UPDATE=0
  NEEDS_ENGINES_UPDATE=0
  if [ "$CURRENT_NVM" != "$DESIRED_NVM" ]; then
    NEEDS_NVM_UPDATE=1
  fi
  if [ "$CURRENT_ENGINE_RANGE" != "$DESIRED_ENGINE_RANGE" ]; then
    NEEDS_ENGINES_UPDATE=1
  fi

  if [ "$NEEDS_NVM_UPDATE" -eq 0 ] && [ "$NEEDS_ENGINES_UPDATE" -eq 0 ]; then
    log "Toolchain sync (node): already aligned (electron=$ELECTRON_VERSION node=$ELECTRON_NODE)."
  elif [ "$APPLY" -eq 1 ]; then
    if [ "$NEEDS_NVM_UPDATE" -eq 1 ]; then
      printf '%s\n' "$DESIRED_NVM" > "$NVMRC"
    fi
    if [ "$NEEDS_ENGINES_UPDATE" -eq 1 ]; then
      TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/tearleads-package-json.XXXXXX")
      jq --arg nodeRange "$DESIRED_ENGINE_RANGE" '.engines.node = $nodeRange' "$ROOT_PKG" > "$TMP_FILE"
      mv "$TMP_FILE" "$ROOT_PKG"
    fi
    CHANGED=1
    log "Toolchain sync (node): updated .nvmrc and/or package.json engines.node for electron=$ELECTRON_VERSION."
  else
    log "Toolchain sync (node): would set .nvmrc=$DESIRED_NVM and engines.node=$DESIRED_ENGINE_RANGE (electron=$ELECTRON_VERSION)."
  fi

  # Export node major version for ansible sync
  NODE_MAJOR_FOR_ANSIBLE="$NODE_MAJOR"

  if command -v node >/dev/null 2>&1; then
    RUNTIME_NODE=$(node -p 'process.version' 2>/dev/null | tr -d '\r\n' || true)
    if [ -n "$RUNTIME_NODE" ] && [ "$RUNTIME_NODE" != "$DESIRED_NVM" ]; then
      NODE_RUNTIME_MISMATCH=1
      log "Toolchain sync (node): active runtime is $RUNTIME_NODE; desired is $DESIRED_NVM."
    fi
  fi
}

sync_android() {
  ANDROID_VARS="$REPO_ROOT/packages/client/android/variables.gradle"
  if [ ! -f "$ANDROID_VARS" ]; then
    log "Toolchain sync (android): skipped; $ANDROID_VARS is missing."
    return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log "Toolchain sync (android): skipped; curl is not available."
    return
  fi
  if ! command -v xmllint >/dev/null 2>&1; then
    log "Toolchain sync (android): skipped; xmllint is not available."
    return
  fi
  if ! command -v rg >/dev/null 2>&1; then
    log "Toolchain sync (android): skipped; rg is not available."
    return
  fi

  ANDROID_REPO_XML=$(curl -fsSL https://dl.google.com/android/repository/repository2-1.xml 2>/dev/null || true)
  if [ -z "$ANDROID_REPO_XML" ]; then
    log "Toolchain sync (android): skipped; unable to fetch Android SDK repository metadata."
    return
  fi

  LATEST_API=$(printf '%s' "$ANDROID_REPO_XML" \
    | xmllint --xpath "//*[local-name()='remotePackage'][starts-with(@path,'platforms;android-') and (not(*[local-name()='channelRef']) or *[local-name()='channelRef'][@ref='channel-0'])]/@path" - 2>/dev/null \
    | rg -o 'platforms;android-[0-9]+' \
    | sed 's/.*android-//' \
    | sort -n \
    | tail -1)
  if [ -z "$LATEST_API" ]; then
    log "Toolchain sync (android): skipped; unable to determine latest stable API level."
    return
  fi

  CURRENT_COMPILE=$(awk -F= '/compileSdkVersion/{gsub(/[^0-9]/, "", $2); print $2; exit}' "$ANDROID_VARS")
  CURRENT_TARGET=$(awk -F= '/targetSdkVersion/{gsub(/[^0-9]/, "", $2); print $2; exit}' "$ANDROID_VARS")
  if [ -z "$CURRENT_COMPILE" ] || [ -z "$CURRENT_TARGET" ]; then
    log "Toolchain sync (android): skipped; unable to read compile/target SDK versions."
    return
  fi

  DESIRED_COMPILE="$CURRENT_COMPILE"
  DESIRED_TARGET="$CURRENT_TARGET"
  COMPILE_JUMP=0
  TARGET_JUMP=0

  if [ "$LATEST_API" -gt "$CURRENT_COMPILE" ]; then
    DESIRED_COMPILE="$LATEST_API"
    COMPILE_JUMP=$((LATEST_API - CURRENT_COMPILE))
  fi
  if [ "$LATEST_API" -gt "$CURRENT_TARGET" ]; then
    DESIRED_TARGET="$LATEST_API"
    TARGET_JUMP=$((LATEST_API - CURRENT_TARGET))
  fi

  if [ "$DESIRED_COMPILE" = "$CURRENT_COMPILE" ] && [ "$DESIRED_TARGET" = "$CURRENT_TARGET" ]; then
    log "Toolchain sync (android): already aligned (compileSdkVersion=$CURRENT_COMPILE targetSdkVersion=$CURRENT_TARGET)."
    return
  fi

  if [ "$COMPILE_JUMP" -gt "$MAX_ANDROID_JUMP" ] || [ "$TARGET_JUMP" -gt "$MAX_ANDROID_JUMP" ]; then
    log "Toolchain sync (android): skipped; required API bump exceeds max jump ($MAX_ANDROID_JUMP)."
    log "Toolchain sync (android): run with --max-android-jump <n> to allow a larger bump."
    return
  fi

  if [ "$APPLY" -eq 1 ]; then
    TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/tearleads-android-vars.XXXXXX")
    awk -v compile="$DESIRED_COMPILE" -v target="$DESIRED_TARGET" '
      /compileSdkVersion[[:space:]]*=/ { sub(/[0-9]+/, compile) }
      /targetSdkVersion[[:space:]]*=/ { sub(/[0-9]+/, target) }
      { print }
    ' "$ANDROID_VARS" > "$TMP_FILE"
    mv "$TMP_FILE" "$ANDROID_VARS"
    CHANGED=1
    log "Toolchain sync (android): updated compileSdkVersion=$DESIRED_COMPILE targetSdkVersion=$DESIRED_TARGET."
  else
    log "Toolchain sync (android): would set compileSdkVersion=$DESIRED_COMPILE targetSdkVersion=$DESIRED_TARGET."
  fi
}

sync_ansible() {
  ANSIBLE_NODE_FILES="$REPO_ROOT/ansible/playbooks/tuxedo.yml $REPO_ROOT/ansible/playbooks/developerLaptop.yml"

  if [ -z "$NODE_MAJOR_FOR_ANSIBLE" ]; then
    # Fall back to reading from .nvmrc if sync_node was skipped
    NVMRC="$REPO_ROOT/.nvmrc"
    if [ -f "$NVMRC" ]; then
      NVMRC_VERSION=$(tr -d ' \t\r\n' < "$NVMRC" | sed 's/^v//')
      NODE_MAJOR_FOR_ANSIBLE=${NVMRC_VERSION%%.*}
    fi
  fi

  if [ -z "$NODE_MAJOR_FOR_ANSIBLE" ]; then
    log "Toolchain sync (ansible): skipped; no Node major version available."
    return
  fi

  ANSIBLE_FILES_UPDATED=0

  for YML_FILE in $ANSIBLE_NODE_FILES; do
    if [ ! -f "$YML_FILE" ]; then
      log "Toolchain sync (ansible): skipped $YML_FILE (file not found)."
      continue
    fi

    CURRENT_ANSIBLE_NODE=$(sed -n 's/^ *nodejs_major_version: *\([0-9]\+\).*/\1/p' "$YML_FILE")
    if [ -z "$CURRENT_ANSIBLE_NODE" ]; then
      log "Toolchain sync (ansible): skipped $YML_FILE (nodejs_major_version not found)."
      continue
    fi

    if [ "$CURRENT_ANSIBLE_NODE" = "$NODE_MAJOR_FOR_ANSIBLE" ]; then
      log "Toolchain sync (ansible): $(basename "$YML_FILE") already aligned (nodejs_major_version=$CURRENT_ANSIBLE_NODE)."
      continue
    fi

    if [ "$APPLY" -eq 1 ]; then
      TMP_FILE=$(mktemp "${TMPDIR:-/tmp}/tearleads-ansible-yml.XXXXXX")
      sed "s/^\( *nodejs_major_version: \)[0-9]\+/\1$NODE_MAJOR_FOR_ANSIBLE/" "$YML_FILE" > "$TMP_FILE"
      mv "$TMP_FILE" "$YML_FILE"
      ANSIBLE_FILES_UPDATED=1
      log "Toolchain sync (ansible): updated $(basename "$YML_FILE") nodejs_major_version=$NODE_MAJOR_FOR_ANSIBLE."
    else
      log "Toolchain sync (ansible): would set $(basename "$YML_FILE") nodejs_major_version=$NODE_MAJOR_FOR_ANSIBLE."
    fi
  done

  if [ "$ANSIBLE_FILES_UPDATED" -eq 1 ]; then
    CHANGED=1
  fi
}

if [ "$SKIP_NODE" -ne 1 ]; then
  sync_node
else
  log "Toolchain sync (node): skipped (--skip-node)."
fi

if [ "$SKIP_ANDROID" -ne 1 ]; then
  sync_android
else
  log "Toolchain sync (android): skipped (--skip-android)."
fi

# Sync ansible node version. It uses the version from sync_node or falls back to .nvmrc.
sync_ansible

if [ "$APPLY" -eq 1 ] && [ "$CHANGED" -eq 1 ]; then
  log "Toolchain sync: applied updates."
fi

if [ "$APPLY" -eq 1 ] && [ "$NODE_RUNTIME_MISMATCH" -eq 1 ] && [ "$ALLOW_RUNTIME_MISMATCH" -ne 1 ]; then
  log "Toolchain sync: switch to the desired Node version (mise install node) and rerun."
  exit 3
fi

exit 0
