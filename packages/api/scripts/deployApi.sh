#!/usr/bin/env bash
# Deploy the Tearleads API Worker for one tier.
#
# Runs in order:
#   1. Read the tier's database and blob storage connection outputs
#   2. Run database migrations with the migration login
#   3. Sync the Worker's secrets from those outputs and the tier secrets
#   4. Publish the Worker with its build constants
#
# Migrations precede the Worker so the schema is never behind the code that
# reads it; the schema baseline is additive and the previous Worker keeps
# serving during the migration. The public hostname is attached by the edge
# Terraform stack, which the tier deployment applies afterwards.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $(basename "$0") <staging|prod>" >&2
  exit 1
fi

TIER="$1"
case "$TIER" in
  staging) SENTRY_DSN_VARIABLE="SENTRY_API_STAGING_DSN" ;;
  prod) SENTRY_DSN_VARIABLE="SENTRY_API_PRODUCTION_DSN" ;;
  *)
    echo "ERROR: unknown API deploy tier: $TIER" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel)"
API_DIR="$REPO_ROOT/packages/api"

# shellcheck source=../../../terraform/scripts/common.sh
# shellcheck disable=SC1091
. "$REPO_ROOT/terraform/scripts/common.sh"

load_secrets_env "$TIER"
validate_aws_env
validate_domain_env
validate_stripe_env "$TIER"
export_wrangler_env

# Secrets pass through shell variables from here until the Worker upload, so a
# traced run (`bash -x`) must not print them; tracing resumes before the
# deploy itself.
XTRACE_WAS_ENABLED=0
if [[ "$-" == *x* ]]; then
  XTRACE_WAS_ENABLED=1
  set +x
fi

# Blob garbage collection pings Healthchecks around every hourly run; a tier
# without a check would fail silently, as the retired timer refused to.
if [[ "${BLOB_GC_HEALTHCHECK_URL:-}" != https://* ]]; then
  echo "ERROR: BLOB_GC_HEALTHCHECK_URL must be an https URL; set it in .secrets/$TIER.healthchecks.env." >&2
  exit 1
fi

# The cursor HMAC key is generated once per tier and kept beside the other
# tier secrets; rotating it re-verifies every object's history once.
WORKER_ENV_FILE="$REPO_ROOT/.secrets/$TIER.worker.env"
if [[ -z "${DOCUMENT_SYNC_CURSOR_HMAC_KEY:-}" ]]; then
  (
    umask 077
    printf 'export DOCUMENT_SYNC_CURSOR_HMAC_KEY=%s\n' "$(openssl rand -hex 32)" >>"$WORKER_ENV_FILE"
  )
  load_secrets_env "$TIER"
fi
if [[ "${#DOCUMENT_SYNC_CURSOR_HMAC_KEY}" -lt 32 ]]; then
  echo "ERROR: DOCUMENT_SYNC_CURSOR_HMAC_KEY must be at least 32 bytes." >&2
  exit 1
fi

umask 077
CONNECTION_DIR=$(mktemp -d "${TMPDIR:-/tmp}/tearleads-${TIER}-worker-XXXXXX")
trap 'rm -rf "$CONNECTION_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Reading $TIER database and storage connection outputs..."
"$REPO_ROOT/terraform/scripts/run-postgres-stack.sh" "$TIER" output -json api_connection >"$CONNECTION_DIR/postgres.json"
"$REPO_ROOT/terraform/scripts/run-storage-stack.sh" "$TIER" output -json api_storage >"$CONNECTION_DIR/storage.json"

read_connection() {
  jq -r --arg key "$2" '.[$key] // empty' "$CONNECTION_DIR/$1.json"
}

echo "Running $TIER database migrations..."
(
  # The shared database module prefers a connection URL over the parts, so an
  # inherited development URL must not steer the migration elsewhere.
  unset DATABASE_URL POSTGRES_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
  export NODE_ENV=production
  export API_DATABASE=postgres
  export POSTGRES_HOST POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DATABASE
  POSTGRES_HOST="$(read_connection postgres postgres_host)"
  POSTGRES_PORT="$(read_connection postgres postgres_migration_port)"
  POSTGRES_USER="$(read_connection postgres postgres_migration_user)"
  POSTGRES_PASSWORD="$(read_connection postgres postgres_migration_password)"
  POSTGRES_DATABASE="$(read_connection postgres postgres_db)"
  export POSTGRES_SSL=true
  export POSTGRES_SSL_REJECT_UNAUTHORIZED=true
  cd "$REPO_ROOT/packages/api-cli"
  bun src/index.ts migrate
)

echo "Syncing $TIER Worker secrets..."
SECRETS_FILE="$CONNECTION_DIR/secrets.json"
API_SENTRY_DSN="${!SENTRY_DSN_VARIABLE:-}"
export API_SENTRY_DSN
# The sandbox flag is written on every deploy so a tier that stops opting in
# cannot keep an earlier "true" secret.
export REVENUECAT_ALLOW_SANDBOX_EVENTS="${REVENUECAT_ALLOW_SANDBOX_EVENTS:-}"
export BLOB_GC_HEALTHCHECK_URL
# Secrets reach jq through its environment, never its argument list, which
# any process on the host can read.
export DOCUMENT_SYNC_CURSOR_HMAC_KEY
jq -n \
  --slurpfile postgres "$CONNECTION_DIR/postgres.json" \
  --slurpfile storage "$CONNECTION_DIR/storage.json" \
  '
  def optional($name):
    if ((env[$name] // "") | length) > 0 then { ($name): env[$name] } else {} end;
  {
    POSTGRES_HOST: $postgres[0].postgres_host,
    POSTGRES_PORT: $postgres[0].postgres_port,
    POSTGRES_USER: $postgres[0].postgres_user,
    POSTGRES_PASSWORD: $postgres[0].postgres_password,
    POSTGRES_DATABASE: $postgres[0].postgres_db,
    DOCUMENT_SYNC_CURSOR_HMAC_KEY: env.DOCUMENT_SYNC_CURSOR_HMAC_KEY,
    BLOB_GC_HEALTHCHECK_URL: env.BLOB_GC_HEALTHCHECK_URL,
    BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID: $storage[0].blob_s3_access_key_id,
    BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY: $storage[0].blob_s3_secret_access_key
  }
  + (if (($storage[0].blob_s3_key_prefix // "") | length) > 0
     then { BLOB_OBJECT_STORE_S3_KEY_PREFIX: $storage[0].blob_s3_key_prefix }
     else {} end)
  + ([
      "API_SENTRY_DSN",
      "REVENUECAT_WEBHOOK_AUTH_HEADER",
      "REVENUECAT_V2_SECRET_KEY",
      "REVENUECAT_PROJECT_ID",
      "REVENUECAT_STRIPE_PUBLIC_API_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_SYNC_SOLO_PRICE_ID",
      "STRIPE_SYNC_TEAM_5_PRICE_ID",
      "STRIPE_SYNC_TEAM_10_PRICE_ID"
    ] | map(optional(.)) | add)
  + { REVENUECAT_ALLOW_SANDBOX_EVENTS:
        (if ((env.REVENUECAT_ALLOW_SANDBOX_EVENTS // "") | ascii_downcase) == "true"
         then "true" else "false" end) }
  ' >"$SECRETS_FILE"
if ! jq -e 'type == "object" and (to_entries | all(.value | type == "string"))' "$SECRETS_FILE" >/dev/null; then
  echo "ERROR: The Worker secrets file is not a flat object of strings." >&2
  exit 1
fi
(cd "$API_DIR" && bunx --no-install wrangler secret bulk "$SECRETS_FILE" --env "$TIER")

# A secret this deploy no longer sets must not keep an earlier value alive:
# an integration disabled in the tier file has to stay disabled.
echo "Removing $TIER Worker secrets this deploy does not manage..."
MANAGED_SECRETS="$(jq -r 'keys[]' "$SECRETS_FILE")"
DEPLOYED_SECRETS="$(cd "$API_DIR" && bunx --no-install wrangler secret list --env "$TIER" --format json | jq -r '.[].name')"
while IFS= read -r deployed_secret; do
  [[ -n "$deployed_secret" ]] || continue
  if ! grep -Fqx "$deployed_secret" <<<"$MANAGED_SECRETS"; then
    echo "Removing stale secret $deployed_secret"
    (cd "$API_DIR" && bunx --no-install wrangler secret delete "$deployed_secret" --env "$TIER")
  fi
done <<<"$DEPLOYED_SECRETS"

echo "Publishing $TIER API Worker..."
DEFINE_ARGS=()
# Captured first so a failing printer stops the deploy; a process
# substitution's exit status is never checked.
DEFINES_OUTPUT="$(cd "$API_DIR" && bun scripts/workerDefines.ts)"
while IFS= read -r define; do
  [[ -n "$define" ]] && DEFINE_ARGS+=(--define "$define")
done <<<"$DEFINES_OUTPUT"
# The public origin and browser origins follow TF_VAR_domain, like the
# Terraform stacks and the app builds, rather than a name in wrangler.jsonc.
# Native releases fetch the API from Capacitor and Electrobun loopback origins.
API_PUBLIC_ORIGIN="https://$(tier_api_hostname "$TIER")"
API_CORS_ORIGINS="https://$(tier_app_hostname "$TIER"),https://$(tier_demo_hostname "$TIER"),https://localhost,http://127.0.0.1:3002"
if [[ "$XTRACE_WAS_ENABLED" -eq 1 ]]; then
  set -x
fi
(cd "$API_DIR" && bunx --no-install wrangler deploy --env "$TIER" "${DEFINE_ARGS[@]}" \
  --var "API_PUBLIC_ORIGIN:$API_PUBLIC_ORIGIN" \
  --var "API_CORS_ORIGINS:$API_CORS_ORIGINS")

echo "API Worker deployed ($TIER)."
