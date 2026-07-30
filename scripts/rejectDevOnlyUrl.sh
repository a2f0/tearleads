# shellcheck shell=sh
# Shared guard for the store-release build/upload scripts. Not executable on its
# own — source it: `. "$SCRIPT_DIR/rejectDevOnlyUrl.sh"`.
#
# Refuses a dev-only backend URL before it is inlined into a store bundle. A
# laptop's LAN address (10.x, 192.168.x, 172.16-31.x), loopback, 0.0.0.0, or a
# `.local` name is only reachable from the build machine, so shipping one bakes
# the "webpage at 10.0.1.10:8085 is not available" failure into the installed
# app. The `:-` defaults in the callers intentionally keep an explicitly-exported
# public URL but must not pass a dev one through. A LAN-pointed release for local
# testing belongs in `android:sideload:release`, not a store release; the dev
# run-on-device scripts (runAndroid.sh, runIos.sh) deliberately do not source
# this and keep their emulator/localhost defaults.
reject_dev_only_url() {
  reject_name="$1"
  reject_url="$2"
  [ -n "$reject_url" ] || return 0
  reject_host="${reject_url#*://}"
  reject_host="${reject_host%%/*}"
  reject_host="${reject_host%%:*}"
  case "$reject_host" in
    localhost | 0.0.0.0 | 127.* | 10.* | 192.168.* | \
      172.1[6-9].* | 172.2[0-9].* | 172.3[01].* | *.local)
      echo "Error: $reject_name=$reject_url points at a dev-only host ($reject_host)." >&2
      echo "A store release must use a public API URL (e.g. https://api.tearleads.com)." >&2
      echo "Unset $reject_name (or set it to a public URL) and re-run." >&2
      exit 1
      ;;
  esac
}

# RevenueCat Test Store keys are useful for local native builds, but Apple and
# Google store releases must use their platform-specific public SDK keys. Guard
# exported overrides before Fastlane loads its dotenv files (dotenv preserves
# an already-exported value). An empty value is allowed here because Fastlane
# may load the key from the release dotenv file; Fastlane validates it again.
reject_invalid_revenuecat_store_key() {
  reject_name="$1"
  reject_key="$2"
  reject_prefix="$3"
  [ -n "$reject_key" ] || return 0
  case "$reject_key" in
    "$reject_prefix"*) return 0 ;;
    *)
      echo "Error: $reject_name is not a RevenueCat platform public SDK key." >&2
      echo "A store release key for this platform must start with $reject_prefix." >&2
      echo "Unset $reject_name (or set it to the platform key) and re-run." >&2
      exit 1
      ;;
  esac
}
