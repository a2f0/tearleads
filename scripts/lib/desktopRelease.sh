# shellcheck shell=sh
# Shared dispatch for desktop build/upload shortcuts; packaging stays in Electrobun.

desktop_release_usage() {
  cat <<EOF
Usage: $(basename "$0")
       $(basename "$0") -h|--help

Runs the ${desktop_tier} ${desktop_platform} release ${desktop_action}.
EOF
  if [ "$desktop_action" = upload ]; then
    echo "Builds and verifies fresh artifacts before publishing to S3."
  fi
}

desktop_release_main() {
  desktop_platform="$1"
  desktop_action="$2"
  desktop_tier="$3"
  shift 3
  case "$desktop_platform:$desktop_action:$desktop_tier" in
    macos:build:production | macos:build:staging | macos:upload:production | macos:upload:staging | linux:build:production | linux:build:staging | linux:upload:production | linux:upload:staging) ;;
    *) echo "Invalid desktop release target." >&2; return 1 ;;
  esac

  case "$#:${1:-}" in
    0:) ;;
    1:-h | 1:--help) desktop_release_usage; return 0 ;;
    *) desktop_release_usage >&2; return 1 ;;
  esac

  case "$desktop_platform" in
    macos) desktop_driver=releaseMacos.sh ;;
    linux) desktop_driver=releaseLinux.sh ;;
  esac
  desktop_repo_root="$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)"
  cd "$desktop_repo_root" || return 1
  exec bash "$desktop_repo_root/packages/app-electrobun/scripts/$desktop_driver" "$desktop_action" "$desktop_tier"
}
