#!/bin/sh

set -eu

if [ "$(uname -s)" != "Linux" ]; then
  echo "The Electrobun persistence smoke test requires Linux." >&2
  exit 1
fi

if [ -z "${DISPLAY:-}" ]; then
  echo "The Electrobun persistence smoke test requires an X11 DISPLAY." >&2
  exit 1
fi

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
package_dir=$(CDPATH='' cd -- "$script_dir/.." && pwd)
devtools_url="http://127.0.0.1:9222/json"

smoke_root=""
app_pid=""
round_log=""

stop_app() {
  if [ -z "$app_pid" ]; then
    return
  fi

  if kill -0 "$app_pid" 2>/dev/null; then
    /bin/kill -INT -- "-$app_pid" 2>/dev/null || true
    sleep 2
    /bin/kill -KILL -- "-$app_pid" 2>/dev/null || true
  fi
  wait "$app_pid" 2>/dev/null || true
  app_pid=""
}

cleanup() {
  stop_app
  case "$smoke_root" in
    /tmp/tearleads-electrobun-persistence-*) rm -rf -- "$smoke_root" ;;
  esac
}

trap cleanup EXIT INT TERM

assert_cef_launch() {
  if ! grep -q "CEF EVENT LOOP STARTED" "$round_log"; then
    echo "Electrobun did not select CEF:" >&2
    cat "$round_log" >&2
    exit 1
  fi

  if grep -q "GLXBadWindow" "$round_log"; then
    echo "Electrobun reported GLXBadWindow:" >&2
    cat "$round_log" >&2
    exit 1
  fi
}

start_app() {
  round_log="$smoke_root/$1.log"
  setsid env \
    HOME="$smoke_root/home" \
    TEARLEADS_ELECTROBUN_PACKAGE_DIR="$package_dir" \
    XDG_CACHE_HOME="$smoke_root/cache" \
    XDG_DATA_HOME="$smoke_root/data" \
    sh "$package_dir/scripts/runElectronbun.sh" dev >"$round_log" 2>&1 &
  app_pid=$!

  attempt=0
  while [ "$attempt" -lt 225 ]; do
    if curl --fail --max-time 1 --silent "$devtools_url" >/dev/null; then
      return
    fi
    if ! kill -0 "$app_pid" 2>/dev/null; then
      echo "Electrobun exited during startup:" >&2
      cat "$round_log" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 0.2
  done

  echo "Timed out waiting for the CEF DevTools endpoint:" >&2
  cat "$round_log" >&2
  exit 1
}

if curl --fail --max-time 1 --silent "$devtools_url" >/dev/null 2>&1; then
  echo "CEF DevTools port 9222 is already in use." >&2
  exit 1
fi

smoke_root=$(mktemp -d /tmp/tearleads-electrobun-persistence-XXXXXX)
mkdir -p "$smoke_root/home" "$smoke_root/cache" "$smoke_root/data"
first_state="$smoke_root/first-state.json"

start_app first
if ! bun "$script_dir/probeLinuxPersistence.ts" first >"$first_state"; then
  cat "$round_log" >&2
  exit 1
fi
stop_app
assert_cef_launch

start_app reopen
if ! bun "$script_dir/probeLinuxPersistence.ts" reopen "$first_state"; then
  cat "$round_log" >&2
  exit 1
fi
stop_app
assert_cef_launch

echo "Electrobun Linux CEF persistence smoke test passed."
