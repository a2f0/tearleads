# shellcheck shell=bash
# The teardown shared by scripts/destroyStaging.sh and
# scripts/destroyProduction.sh. Not executable on its own: the caller confirms
# first, then sources this and calls destroy_tier <staging|prod>.
#
# Runs in order:
#   1. Edge stack: detach the API, app, and demo hostnames
#   2. API Worker and its Durable Objects (sessions, tickets, socket state)
#   3. App and demo Workers
#   4. Database objects the migration login owns, which PlanetScale requires
#      before it deletes the login's role
#   5. Postgres stack: Hyperdrive, roles, and the PlanetScale database
#   6. Blob bucket objects, then the storage stack
#   7. Desktop downloads bucket objects, then the downloads stack
#   8. Website domain, then its Worker
#
# Removing the hostnames and Workers first stops every writer before any data
# is deleted. Each step is timed; the summary prints however the run ends, and
# a failed run names the step it stopped in.

destroy_tier_report() {
  destroy_tier_status=$?
  if [ -n "$step_timings_open_label" ]; then
    echo "Teardown stopped in [$step_timings_open_label]; later steps did not run." >&2
  fi
  step_timings_summary
  return "$destroy_tier_status"
}

destroy_tier() {
  destroy_tier_root="$(git rev-parse --show-toplevel)"
  destroy_tier_terraform="$destroy_tier_root/terraform/scripts"
  # shellcheck source=./stepTimings.sh
  # shellcheck disable=SC1091
  . "$destroy_tier_root/scripts/lib/stepTimings.sh"
  step_timings_reset
  trap destroy_tier_report EXIT

  step_timings_run edge "$destroy_tier_terraform/destroy-stack.sh" "$1" edge
  step_timings_run api "$destroy_tier_root/packages/api/scripts/destroyApi.sh" "$1"
  step_timings_run app-web "$destroy_tier_root/packages/app-web/scripts/destroyAppWeb.sh" "$1"
  step_timings_run postgres-objects "$destroy_tier_terraform/drop-postgres-owned.sh" "$1"
  step_timings_run postgres "$destroy_tier_terraform/destroy-stack.sh" "$1" postgres
  step_timings_run blobs-empty "$destroy_tier_terraform/empty-r2-bucket.sh" "$1" storage
  step_timings_run storage "$destroy_tier_terraform/destroy-stack.sh" "$1" storage
  step_timings_run downloads-empty "$destroy_tier_terraform/empty-r2-bucket.sh" "$1" downloads
  step_timings_run downloads "$destroy_tier_terraform/destroy-stack.sh" "$1" downloads
  step_timings_run website "$destroy_tier_root/packages/website/scripts/destroyWebsite.sh" "$1"
  echo "Every $1 resource was destroyed."
}
