#!/usr/bin/env bash
# Build once, upload the exact bundle/map pair, then deploy that bundle unchanged.

configure_api_sentry() {
  local tier="$1"
  case "$tier" in
    staging)
      API_SENTRY_DSN="${SENTRY_API_STAGING_DSN:-}"
      API_SENTRY_ENVIRONMENT=staging
      API_SENTRY_PROJECT="${SENTRY_API_STAGING_PROJECT:-tearleads-api-staging}"
      ;;
    prod)
      API_SENTRY_DSN="${SENTRY_API_PRODUCTION_DSN:-}"
      API_SENTRY_ENVIRONMENT=production
      API_SENTRY_PROJECT="${SENTRY_API_PRODUCTION_PROJECT:-tearleads-api-production}"
      ;;
    *) echo "ERROR: Unknown API Sentry tier." >&2; return 1 ;;
  esac
  if [[ -n "$API_SENTRY_DSN" && ( -z "${SENTRY_ORG:-}" || -z "${SENTRY_AUTH_TOKEN:-}" ) ]]; then
    echo "ERROR: Configured API diagnostics require SENTRY_ORG and SENTRY_AUTH_TOKEN for source maps." >&2
    return 1
  fi
  export API_SENTRY_DSN
}

build_api_worker() {
  local api_dir="$1" tier="$2" config="$3" output="$4"
  local commit defines_text define
  local -a defines=()
  commit="$(git -C "$api_dir" rev-parse HEAD)" || return 1
  if [[ -n "${API_SENTRY_DSN:-}" && -n "$(git -C "$api_dir" status --porcelain)" ]]; then
    echo "ERROR: API source-map publishing requires a clean checkout." >&2
    return 1
  fi
  defines_text="$(cd "$api_dir" && bun scripts/workerDefines.ts)" || return 1
  while IFS= read -r define; do
    [[ -n "$define" ]] && defines+=(--define "$define")
  done <<<"$defines_text"
  (cd "$api_dir" && bunx --no-install wrangler deploy --dry-run \
    --outdir "$output" --env "$tier" --config "$config" "${defines[@]}") || return 1
  if [[ ! -s "$output/index.js" || ! -s "$output/index.js.map" ]]; then
    echo "ERROR: Missing API Worker bundle or source map." >&2
    return 1
  fi
  if [[ "$commit" != "$(git -C "$api_dir" rev-parse HEAD)" ]]; then
    echo "ERROR: API revision changed during the build." >&2
    return 1
  fi
  [[ -n "${API_SENTRY_DSN:-}" ]] || return 0
  if [[ -n "$(git -C "$api_dir" status --porcelain)" ]]; then
    echo "ERROR: API checkout changed during the build." >&2
    return 1
  fi
  (cd "$api_dir" && bun run sentry:cli sourcemaps upload \
    --org "$SENTRY_ORG" --project "$API_SENTRY_PROJECT" \
    --release "tearleads-api@$commit" --dist "$API_SENTRY_ENVIRONMENT" \
    --url-prefix 'app:///' --validate --strict --wait "$output/index.js" "$output/index.js.map")
}
