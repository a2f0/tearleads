#!/usr/bin/env bash
# Sourced after tiered secrets. Only the DSN is public; upload credentials never
# receive a BUN_PUBLIC_ prefix. Explicit tier keys prevent cross-project routing.

configure_sentry_env() {
  local tier="$1"
  unset BUN_PUBLIC_SENTRY_DSN BUN_PUBLIC_SENTRY_ENVIRONMENT SENTRY_PROJECT
  BUN_PUBLIC_SENTRY_COMMIT=""
  case "$tier" in
    staging)
      BUN_PUBLIC_SENTRY_DSN="${SENTRY_STAGING_DSN:-}"
      BUN_PUBLIC_SENTRY_ENVIRONMENT="staging"
      SENTRY_PROJECT="${SENTRY_STAGING_PROJECT:-}"
      ;;
    prod)
      BUN_PUBLIC_SENTRY_DSN="${SENTRY_PRODUCTION_DSN:-}"
      BUN_PUBLIC_SENTRY_ENVIRONMENT="production"
      SENTRY_PROJECT="${SENTRY_PRODUCTION_PROJECT:-}"
      ;;
    *) echo "ERROR: Unknown Sentry tier." >&2; return 1 ;;
  esac
  if [[ -z "$BUN_PUBLIC_SENTRY_DSN" ]]; then
    echo "Sentry is disabled for $tier: no tier DSN configured." >&2
  elif [[ ! "$BUN_PUBLIC_SENTRY_DSN" =~ ^https://[a-f0-9]{32}@o[0-9]+\.ingest(\.(us|de))?\.sentry\.io/[0-9]+$ ]]; then
    echo "ERROR: The tier Sentry DSN must be a valid hosted Sentry browser DSN." >&2
    return 1
  elif [[ -z "$SENTRY_PROJECT" || -z "${SENTRY_ORG:-}" || -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
    echo "ERROR: Sentry requires the tier project slug, SENTRY_ORG and SENTRY_AUTH_TOKEN for source map uploads." >&2
    return 1
  fi
  if [[ -n "$BUN_PUBLIC_SENTRY_DSN" ]]; then
    BUN_PUBLIC_SENTRY_COMMIT="$(git rev-parse HEAD)" || return 1
  fi
  export BUN_PUBLIC_SENTRY_DSN BUN_PUBLIC_SENTRY_ENVIRONMENT BUN_PUBLIC_SENTRY_COMMIT SENTRY_PROJECT
}

upload_sentry_source_maps() {
  local app_web_dir="$1"
  local variant="$2"
  [[ -n "${BUN_PUBLIC_SENTRY_DSN:-}" && "$variant" == "app" ]] || return 0
  echo "Uploading $BUN_PUBLIC_SENTRY_ENVIRONMENT app source maps to Sentry..."
  (
    cd "$app_web_dir" || exit 1
    bun run sentry:cli sourcemaps upload \
      --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" \
      --release "tearleads-web@$BUN_PUBLIC_SENTRY_COMMIT" \
      --dist "$BUN_PUBLIC_SENTRY_ENVIRONMENT-app" \
      --url-prefix 'app:///' --validate --strict dist
  )
}
