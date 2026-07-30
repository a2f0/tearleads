# shellcheck shell=sh
# Shared implementation for native store build/upload wrappers. Source this file
# and call native_release_main with platform, action, and tier.

native_release_default_api() {
  case "$1" in
    production) printf '%s\n' "https://api.tearleads.com" ;;
    staging) printf '%s\n' "https://api.tearleads.de" ;;
    *) return 1 ;;
  esac
}

native_release_usage() {
  native_platform="$1"
  native_action="$2"
  native_tier="$3"
  native_default_api="$(native_release_default_api "$native_tier")"
  native_action_description="Build"
  [ "$native_action" != upload ] || native_action_description="Build and upload"

  cat <<EOF
Usage: $(basename "$0") [fastlane-options...]

${native_action_description} the ${native_tier} ${native_platform} store release.

The native app identifier is selected by NATIVE_RELEASE_TIER:
  production  com.tearleads.app
  staging     com.tearleads.app.staging

Environment:
  VITE_API_BASE_URL  API URL inlined into the Capacitor bundle.
                     Defaults to ${native_default_api}.

Store credentials and signing values are loaded by Fastlane from
.secrets/root.env plus .secrets/${native_tier}.env where applicable. Explicitly
exported environment variables take precedence.

NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_ANDROID_API_KEY and
NATIVE_RELEASE_PRODUCTION_VITE_REVENUECAT_IOS_API_KEY may provide an independent
production-key comparison baseline for env-only CI or key rotation.
EOF

  if [ "$native_action" = upload ]; then
    cat <<'EOF'

Upload wrappers default to the next value in the selected app's store. Pass
build_number:<number> to select an explicit build number.
EOF
  else
    cat <<'EOF'

Build wrappers default to the larger of today's merged PR number and the store's
next value. Pass build_number:<number> to select an explicit build number.
EOF
  fi

  if [ "$native_platform" = android ]; then
    cat <<'EOF'

Android options:
  version_code:<number>       Alias for an explicit build number.
  next_google_play:true       Use the latest Play version code plus one.
  google_track:<track>        Upload track; defaults to internal.
  release_status:<status>     Upload release status; defaults to completed.
  validate_only:true          Validate the upload without publishing.

GOOGLE_PLAY_JSON_KEY_FILE (or SUPPLY_JSON_KEY) can override the default Google
Play service-account key path.
EOF
  else
    cat <<'EOF'

iOS options:
  apple_build_number:<number> Alias for an explicit build number.
  next_testflight:true        Use the latest TestFlight build number plus one.
  changelog:<text>            Set the TestFlight What to Test notes.
  distribute_external:true    Distribute to external testers.
  groups:<name,name>          Select external TestFlight groups.
  skip_submission:true        Upload without submitting for review.

The upload wrapper prepares the login keychain before the archive and may prompt
for the macOS login password. iOS releases regenerate icons and splash images,
so ImageMagick must be installed.

App Store Connect authentication uses APP_STORE_CONNECT_KEY_ID,
APP_STORE_CONNECT_ISSUER_ID, and TEAM_ID. The private key defaults to
.secrets/AuthKey_<key-id>.p8.
EOF
  fi
}

native_release_ensure_android_wrapper() {
  native_wrapper_jar="android/gradle/wrapper/gradle-wrapper.jar"
  if [ -f "$native_wrapper_jar" ]; then
    return 0
  fi

  echo "Generating $native_wrapper_jar from repo-managed Gradle..."
  if command -v gradle > /dev/null 2>&1; then
    gradle -p android wrapper --distribution-type all
  elif command -v mise > /dev/null 2>&1; then
    mise exec -- gradle -p android wrapper --distribution-type all
  else
    echo "Error: Gradle is unavailable. Run \`mise install\` from the repo root." >&2
    return 1
  fi
}

native_release_url_host() {
  native_url_value="${1#*://}"
  native_url_authority="${native_url_value%%[/?#]*}"
  native_url_authority="${native_url_authority##*@}"
  native_url_host="${native_url_authority%%:*}"
  printf '%s\n' "$native_url_host" | tr '[:upper:]' '[:lower:]'
}

native_release_tier_domain() {
  case "$1" in
    production) printf '%s\n' "tearleads.com" ;;
    staging) printf '%s\n' "tearleads.de" ;;
    *) return 1 ;;
  esac
}

native_release_require_tier_host() {
  native_url_guard_name="$1"
  native_url_guard_tier="$2"
  native_url_guard_value="$3"
  if [ -z "$native_url_guard_value" ]; then
    return 0
  fi

  native_url_guard_scheme="${native_url_guard_value%%:*}"
  native_url_guard_scheme="$(printf '%s\n' "$native_url_guard_scheme" | tr '[:upper:]' '[:lower:]')"
  case "$native_url_guard_name:$native_url_guard_scheme" in
    VITE_API_BASE_URL:https | VITE_WS_URL:wss) ;;
    *)
      echo "Error: $native_url_guard_name must use a secure release scheme." >&2
      return 1
      ;;
  esac

  native_url_guard_host="$(native_release_url_host "$native_url_guard_value")"
  native_url_guard_expected_url="$(native_release_default_api "$native_url_guard_tier")"
  native_url_guard_expected_host="$(native_release_url_host "$native_url_guard_expected_url")"
  native_url_guard_domain="$(native_release_tier_domain "$native_url_guard_tier")"
  case "$native_url_guard_name:$native_url_guard_host" in
    VITE_API_BASE_URL:"$native_url_guard_expected_host" | \
      VITE_WS_URL:"$native_url_guard_domain" | \
      VITE_WS_URL:*."$native_url_guard_domain") return 0 ;;
  esac

  echo "Error: $native_url_guard_name=$native_url_guard_value uses host $native_url_guard_host." >&2
  if [ "$native_url_guard_name" = VITE_API_BASE_URL ]; then
    echo "A $native_url_guard_tier release API must use $native_url_guard_expected_host." >&2
  else
    echo "A $native_url_guard_tier release WebSocket must use $native_url_guard_domain or one of its subdomains." >&2
  fi
  return 1
}

native_release_guard_environment() {
  native_platform="$1"
  native_tier="$2"
  native_default_api="$(native_release_default_api "$native_tier")"

  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-$native_default_api}"
  reject_dev_only_url VITE_API_BASE_URL "$VITE_API_BASE_URL"
  native_release_require_tier_host VITE_API_BASE_URL "$native_tier" "$VITE_API_BASE_URL"
  reject_dev_only_url VITE_WS_URL "${VITE_WS_URL:-}"
  native_release_require_tier_host VITE_WS_URL "$native_tier" "${VITE_WS_URL:-}"

  if [ "$native_platform" = android ]; then
    reject_invalid_revenuecat_store_key \
      VITE_REVENUECAT_ANDROID_API_KEY "${VITE_REVENUECAT_ANDROID_API_KEY:-}" goog_
  else
    reject_invalid_revenuecat_store_key \
      VITE_REVENUECAT_IOS_API_KEY "${VITE_REVENUECAT_IOS_API_KEY:-}" appl_
  fi
}

native_release_build_number_chosen() {
  native_platform="$1"
  shift

  if [ "$native_platform" = android ]; then
    if [ -n "${ANDROID_BUILD_NUMBER:-}" ] \
      || [ -n "${ANDROID_VERSION_CODE:-}" ] \
      || [ -n "${ANDROID_RELEASE_NEXT_GOOGLE_PLAY:-}" ] \
      || [ -n "${ANDROID_RELEASE_MERGED_PR_NUMBER:-}" ] \
      || [ -n "${ANDROID_RELEASE_PR_NUMBER:-}" ] \
      || [ -n "${ANDROID_RELEASE_MERGED_DATE:-}" ]; then
      return 0
    fi
  else
    if [ -n "${IOS_BUILD_NUMBER:-}" ] \
      || [ -n "${APPLE_BUILD_NUMBER:-}" ] \
      || [ -n "${IOS_RELEASE_NEXT_TESTFLIGHT:-}" ] \
      || [ -n "${IOS_RELEASE_MERGED_PR_NUMBER:-}" ] \
      || [ -n "${IOS_RELEASE_PR_NUMBER:-}" ] \
      || [ -n "${IOS_RELEASE_MERGED_DATE:-}" ]; then
      return 0
    fi
  fi

  for native_arg in "$@"; do
    case "$native_platform:$native_arg" in
      android:build_number:* | android:version_code:* | android:next_google_play:* | android:merged_pr_number:* | android:pr_number:* | android:merged_date:* | \
        ios:build_number:* | ios:apple_build_number:* | ios:next_testflight:* | ios:merged_pr_number:* | ios:pr_number:* | ios:merged_date:*)
        return 0
        ;;
    esac
  done

  return 1
}

native_release_prepare_ios_keychain() {
  native_script_dir="$1"
  "$native_script_dir/keychain/unlockLoginKeychain.sh"
  "$native_script_dir/keychain/authorizeCodesignPartitionList.sh"
}

native_release_bun_command() {
  native_platform="$1"
  native_action="$2"
  native_command_tier="$3"
  native_command_suffix=""
  if [ "$native_command_tier" = staging ]; then
    native_command_suffix=":staging"
  fi

  if [ "$native_platform" = android ]; then
    if [ "$native_action" = upload ]; then
      printf '%s%s\n' android:upload:google-play "$native_command_suffix"
    else
      printf '%s%s\n' android:build:google-play "$native_command_suffix"
    fi
  else
    if [ "$native_action" = upload ]; then
      printf '%s%s\n' ios:upload:testflight "$native_command_suffix"
    else
      printf '%s%s\n' ios:build:testflight "$native_command_suffix"
    fi
  fi
}

native_release_run_upload() {
  native_platform="$1"
  native_command="$2"
  shift 2

  if ! native_release_build_number_chosen "$native_platform" "$@"; then
    if [ "$native_platform" = android ]; then
      set -- "$@" next_google_play:true
    else
      set -- "$@" next_testflight:true
    fi
  fi

  native_build_number_file="$(mktemp "${TMPDIR:-/tmp}/${native_platform}-build-number.XXXXXX")"
  trap 'rm -f "$native_build_number_file"' EXIT
  if [ "$native_platform" = android ]; then
    export ANDROID_RELEASE_BUILD_NUMBER_FILE="$native_build_number_file"
  else
    export IOS_RELEASE_BUILD_NUMBER_FILE="$native_build_number_file"
  fi

  bun run "$native_command" "$@"

  if [ -s "$native_build_number_file" ]; then
    echo "Build number: $(sed -n '1p' "$native_build_number_file")"
  else
    echo "Build number: unknown (Fastlane did not report one)"
  fi
}

native_release_main() {
  # These POSIX-shell globals are intentionally reused by the helpers below;
  # every call in one release invocation carries the same target tuple.
  native_platform="$1"
  native_action="$2"
  native_tier="$3"
  shift 3

  case "$native_platform:$native_action:$native_tier" in
    android:build:production | android:build:staging | android:upload:production | android:upload:staging | ios:build:production | ios:build:staging | ios:upload:production | ios:upload:staging) ;;
    *)
      echo "Error: invalid native release target $native_platform:$native_action:$native_tier" >&2
      return 1
      ;;
  esac

  case "${1:-}" in
    -h | --help)
      native_release_usage "$native_platform" "$native_action" "$native_tier"
      return 0
      ;;
  esac

  native_script_dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
  native_package_dir="$native_script_dir/../packages/app-capacitor"
  cd "$native_package_dir" || return 1

  # shellcheck source=scripts/releaseGuards.sh
  . "$native_script_dir/releaseGuards.sh"

  export NATIVE_RELEASE_TIER="$native_tier"
  native_release_guard_environment "$native_platform" "$native_tier"
  [ "$native_platform" != android ] || native_release_ensure_android_wrapper
  if [ "$native_platform:$native_action" = ios:upload ]; then
    native_release_prepare_ios_keychain "$native_script_dir"
  fi

  native_command="$(native_release_bun_command "$native_platform" "$native_action" "$native_tier")"
  echo "${native_action}ing ${native_tier} ${native_platform} release (NATIVE_RELEASE_TIER=${native_tier})"
  echo "VITE_API_BASE_URL=$VITE_API_BASE_URL"

  if [ "$native_action" = upload ]; then
    native_release_run_upload "$native_platform" "$native_command" "$@"
  else
    exec bun run "$native_command" "$@"
  fi
}
