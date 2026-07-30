# shellcheck shell=sh
# Shared helper for the dev run-on-device scripts. Not executable on its own —
# source it: `. "$SCRIPT_DIR/exportRevenueCatKeys.sh"`.
#
# Vite inlines VITE_* from the build process's environment, so a RevenueCat
# public SDK key that is not exported when `bun run build` runs is simply absent
# from the bundle: createCapacitorPurchases() then returns the unavailable stub
# and the org-manager billing panel offers no purchase at all. Store releases get
# these from Fastlane, whose native_release_target.rb parses the release dotenv
# files and selectively assigns their values before shelling out to the build.
# The dev scripts have no Fastlane in the path, so they read root.env here and a
# simulator/device run can exercise billing like a release can.
#
# These are public client keys, safe to inline; the file is git-ignored only
# because it holds secret values too. A missing file or missing key is not an
# error — a dev run that does not touch billing must still work, it just gets
# the unavailable stub.
export_revenuecat_keys() {
  revenuecat_env_file="$1"
  [ -f "$revenuecat_env_file" ] || return 0
  for revenuecat_key in \
    VITE_REVENUECAT_ANDROID_API_KEY \
    VITE_REVENUECAT_IOS_API_KEY \
    VITE_REVENUECAT_SYNC_ENTITLEMENT; do
    # An already-exported value wins, matching the `:-` defaults the callers use
    # for VITE_API_BASE_URL.
    eval "revenuecat_current=\${${revenuecat_key}:-}"
    [ -z "$revenuecat_current" ] || continue
    # `|| true` because grep exits 1 on no match, which `set -e` would treat as
    # a failure of the whole script.
    revenuecat_line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${revenuecat_key}=" "$revenuecat_env_file" | tail -n 1)" || true
    [ -n "$revenuecat_line" ] || continue
    revenuecat_value="$(
      printf '%s' "$revenuecat_line" |
        sed -e 's/^[[:space:]]*//' -e 's/^export[[:space:]]*//' -e "s/^${revenuecat_key}=//"
    )"
    # dotenv permits quoting the value; the shell must not carry the quotes into
    # the inlined string. An UNQUOTED value ends at the first whitespace, and
    # anything past it is a trailing comment — without that trim,
    # `KEY=appl_x # ios` inlines the comment too and RevenueCat rejects the key
    # with no obvious cause. A quoted value keeps whatever is inside the quotes.
    # Matched on the OPENING quote only: a quoted value may still be followed by
    # a comment, so it does not necessarily end with its closing quote.
    case "$revenuecat_value" in
      \"*)
        revenuecat_value="${revenuecat_value#\"}"
        revenuecat_value="${revenuecat_value%%\"*}"
        ;;
      \'*)
        revenuecat_value="${revenuecat_value#\'}"
        revenuecat_value="${revenuecat_value%%\'*}"
        ;;
      *)
        revenuecat_value="${revenuecat_value%%[[:space:]]*}"
        ;;
    esac
    [ -n "$revenuecat_value" ] || continue
    export "${revenuecat_key}=${revenuecat_value}"
  done
}

# Reports whether the running platform's key made it into the environment, so a
# device run that silently has no purchase path says so up front instead of
# looking like a broken billing panel. Never prints a key value.
report_revenuecat_key() {
  revenuecat_report_key="$1"
  eval "revenuecat_report_value=\${${revenuecat_report_key}:-}"
  if [ -n "$revenuecat_report_value" ]; then
    echo "RevenueCat: ${revenuecat_report_key} is set; purchases enabled in this build"
  else
    echo "RevenueCat: ${revenuecat_report_key} is not set; purchases unavailable in this build"
  fi
}
