# shellcheck shell=sh
# Shared dispatch for desktop build/upload shortcuts; packaging stays in Electrobun.

desktop_release_usage() {
  desktop_optional_tier=""
  [ "$desktop_tier" != production ] || desktop_optional_tier=" [staging|production]"
  cat <<EOF
Usage: $(basename "$0")${desktop_optional_tier}
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
    1:staging | 1:production)
      # Preserve the explicit-tier form of the original production wrappers.
      if [ "$desktop_tier" != production ]; then desktop_release_usage >&2; return 1; fi
      desktop_tier="$1"
      ;;
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
