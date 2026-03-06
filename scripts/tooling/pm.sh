#!/usr/bin/env sh
set -eu

usage() {
  cat <<'EOF' >&2
Usage:
  ./scripts/tooling/pm.sh which
  ./scripts/tooling/pm.sh install [args...]
  ./scripts/tooling/pm.sh run <script> [args...]
  ./scripts/tooling/pm.sh exec <command> [args...]
  ./scripts/tooling/pm.sh <raw-pm-args...>

Environment:
  TEARLEADS_PM=pnpm|bun   Package manager override.
                          Default: pnpm when available, else bun.
EOF
  exit 2
}

resolve_pm() {
  requested="${TEARLEADS_PM:-}"

  if [ -n "$requested" ]; then
    case "$requested" in
      pnpm|bun)
        if command -v "$requested" >/dev/null 2>&1; then
          printf '%s\n' "$requested"
          return 0
        fi
        echo "pm.sh: requested package manager '$requested' is not installed." >&2
        exit 1
        ;;
      *)
        echo "pm.sh: invalid TEARLEADS_PM value '$requested' (expected 'pnpm' or 'bun')." >&2
        exit 1
        ;;
    esac
  fi

  if command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' "pnpm"
    return 0
  fi

  if command -v bun >/dev/null 2>&1; then
    printf '%s\n' "bun"
    return 0
  fi

  echo "pm.sh: neither pnpm nor bun is available in PATH." >&2
  exit 1
}

if [ "$#" -lt 1 ]; then
  usage
fi

PM="$(resolve_pm)"
CMD="$1"
shift

case "$CMD" in
  which)
    printf '%s\n' "$PM"
    ;;
  install)
    if [ "$PM" = "pnpm" ]; then
      exec pnpm install "$@"
    fi
    exec bun install "$@"
    ;;
  run)
    if [ "$#" -lt 1 ]; then
      echo "pm.sh: missing script name for 'run'." >&2
      usage
    fi
    SCRIPT="$1"
    shift
    if [ "$PM" = "pnpm" ]; then
      if [ "$#" -gt 0 ]; then
        exec pnpm run "$SCRIPT" -- "$@"
      fi
      exec pnpm run "$SCRIPT"
    fi
    if [ "$#" -gt 0 ]; then
      exec bun run "$SCRIPT" -- "$@"
    fi
    exec bun run "$SCRIPT"
    ;;
  exec)
    if [ "$#" -lt 1 ]; then
      echo "pm.sh: missing executable for 'exec'." >&2
      usage
    fi
    if [ "$PM" = "pnpm" ]; then
      exec pnpm exec "$@"
    fi
    exec bun x "$@"
    ;;
  *)
    exec "$PM" "$CMD" "$@"
    ;;
esac
