#!/usr/bin/env bash
set -euo pipefail

case "${1:-}:$#" in
  production:1) CHANNEL=stable; APP_NAME=Tearleads ;;
  staging:1) CHANNEL=canary; APP_NAME=Tearleads-canary ;;
  *) echo "Usage: $0 <staging|production> (inside the release container)" >&2; exit 1 ;;
esac
PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER_PREFIX=linux-x64
[[ "$CHANNEL" == stable ]] || INSTALLER_PREFIX=canary-linux-x64
TEST_ROOT="$(mktemp -d)"
export XDG_DATA_HOME="$TEST_ROOT/data"
export TEARLEADS_LINUX_RELEASE_DIR="$XDG_DATA_HOME/com.tearleads.app/$CHANNEL/app"
export DISPLAY=:99
# Start Xvfb directly: xvfb-run's SIGUSR1 readiness handshake can stall in QEMU.
Xvfb "$DISPLAY" -screen 0 1280x1024x24 -nolisten tcp -ac &
DISPLAY_PID=$!
trap '
  kill "$DISPLAY_PID" 2>/dev/null || true
  rm -rf "$TEST_ROOT"
' EXIT
trap 'exit 1' INT TERM
for ((attempt = 0; attempt < 100; attempt++)); do
  if [[ -S /tmp/.X11-unix/X99 ]]; then
    mkdir -p "$TEST_ROOT/setup"
    tar -xzf "$PACKAGE_DIR/build/artifacts/$INSTALLER_PREFIX-$APP_NAME-Setup.tar.gz" -C "$TEST_ROOT/setup"
    # Exercise the downloaded installer, then reopen the installed application.
    (cd "$TEST_ROOT/setup" && timeout 600 ./installer)
    # The installer launches the app. Stop that process before the isolated probe
    # starts its own instance on the desktop renderer's fixed local port.
    pkill -f "$TEARLEADS_LINUX_RELEASE_DIR/" || true
    for ((stop = 0; stop < 150; stop++)); do
      if ! pgrep -f "$TEARLEADS_LINUX_RELEASE_DIR/" >/dev/null; then break; fi
      if ((stop == 50)); then pkill -KILL -f "$TEARLEADS_LINUX_RELEASE_DIR/" || true; fi
      sleep 0.2
    done
    if pgrep -f "$TEARLEADS_LINUX_RELEASE_DIR/" >/dev/null; then
      echo "Timed out stopping the app launched by the installer." >&2
      exit 1
    fi
    dbus-run-session -- sh "$PACKAGE_DIR/scripts/testLinuxPersistence.sh"
    exit 0
  fi
  kill -0 "$DISPLAY_PID"
  sleep 0.2
done
echo "Timed out waiting for the release test display." >&2
exit 1
