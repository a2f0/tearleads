# shellcheck shell=bash
# Dedicated teardown helpers call require_teardown_authorized before loading
# credentials. Staging steps run on their own. Production callers supply
# TEARLEADS_TEARDOWN_TIER=prod after their own confirmation: destroyProduction.sh
# for complete teardown, or softReset.ts for its maintenance/data helpers.
# The low-level stack wrappers do not source this guard; their authorized
# saved-plan callers own confirmation and plan inspection separately.

require_teardown_authorized() {
  case "${1:-}" in
    staging) ;;
    prod)
      if [[ "${TEARLEADS_TEARDOWN_TIER:-}" != prod ]]; then
        echo "ERROR: Production is destroyed only through scripts/deploy/destroyProduction.sh." >&2
        return 1
      fi
      ;;
    *)
      echo "ERROR: Unknown teardown tier: ${1:-}" >&2
      return 1
      ;;
  esac
}
