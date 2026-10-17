# shellcheck shell=bash
# Every teardown step that can delete a tier's data sources this and calls
# require_teardown_authorized before loading credentials. Staging steps run on
# their own; production steps run only under scripts/destroyProduction.sh,
# which asks for the production domain first and then exports
# TEARLEADS_TEARDOWN_TIER=prod for the steps it runs.

require_teardown_authorized() {
  case "${1:-}" in
    staging) ;;
    prod)
      if [[ "${TEARLEADS_TEARDOWN_TIER:-}" != prod ]]; then
        echo "ERROR: Production is destroyed only through scripts/destroyProduction.sh." >&2
        return 1
      fi
      ;;
    *)
      echo "ERROR: Unknown teardown tier: ${1:-}" >&2
      return 1
      ;;
  esac
}
