#!/usr/bin/env bash
# Dispatch a Windows build, or download/publish one completed Actions run.
set -euo pipefail
ACTION="${1:-}"
TIER="${2:-}"
case "$ACTION:$TIER:$#" in
  build:staging:2 | build:production:2 | download:staging:3 | download:production:3 | upload:staging:3 | upload:production:3) ;;
  *) echo "Usage: $0 <build|download|upload> <staging|production> [run-id]" >&2; exit 1 ;;
esac
if [[ "$ACTION" != build && ! "$3" =~ ^[0-9]+$ ]]; then
  echo "Expected a numeric GitHub Actions run ID." >&2; exit 1
fi
for name in "${!GIT_@}"; do unset "$name"; done
REPO_ROOT="$(CDPATH='' cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO_ROOT"
[[ "$(git rev-parse --show-toplevel)" == "$REPO_ROOT" ]] || exit 1
if [[ -n "$(git -c core.excludesFile=/dev/null -c core.fsmonitor=false status --porcelain=v1 --untracked-files=normal)" ]]; then
  echo "Windows releases require a clean Git checkout; commit changes first." >&2; exit 1
fi
if [[ "$ACTION" == upload ]]; then
  # shellcheck source=terraform/scripts/common.sh
  source "$REPO_ROOT/terraform/scripts/common.sh"
  TF_TIER="$TIER"
  [[ "$TIER" != production ]] || TF_TIER=prod
  load_secrets_env "$TF_TIER"
  validate_aws_env
fi
unset SENTRY_AUTH_TOKEN BUN_OPTIONS BUN_INSPECT BUN_INSPECT_CONNECT_TO BUN_INSPECT_NOTIFY BUN_INSPECT_PRELOAD
exec bun --no-env-file --config=/dev/null "$REPO_ROOT/packages/app-electrobun/scripts/releaseWindows.ts" "$@"
