#!/bin/bash
# Cloudflare cache invalidation helpers for deploy scripts.
#
# Sourced by terraform/scripts/common.sh, so every deploy script that already
# sources common.sh gets these for free.
#
# Every function here is best-effort and returns 0 on failure. Deploy scripts
# run under `set -euo pipefail` and call them bare, so a non-zero status would
# abort a deploy whose artifacts are already published.

# Resolve a Cloudflare zone id, echoing it on success and nothing on failure.
# Callers treat an empty result as "skip the purge" — cache invalidation is
# best-effort and must never fail a deploy.
#
# Deploy scripts run under `set -e` and call the purge helpers bare, so a
# transport error here would otherwise abort the deploy *after* rsync already
# succeeded. Every failure path is therefore caught and reported as an empty
# result rather than a non-zero status.
_resolve_cloudflare_zone_id() {
  local domain="$1"
  local response

  if ! response="$(
    curl -sS -X GET "https://api.cloudflare.com/client/v4/zones?name=${domain}&account.id=${TF_VAR_cloudflare_account_id}" \
      -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
      -H "Content-Type: application/json"
  )"; then
    return 0
  fi

  jq -r '.result[0].id // empty' <<< "$response" 2>/dev/null || true
}

# Best-effort Cloudflare cache purge for an explicit list of absolute URLs.
# Usage:
#   purge_cloudflare_cache_for_urls <zone-domain> <url1> [url2 ...]
#
# Cloudflare caps single-file purges at 30 URLs per request outside Enterprise,
# so the list is sent in batches of 30. A failing batch is reported but does not
# abort the remaining batches or the deploy.
purge_cloudflare_cache_for_urls() {
  local domain="$1"
  shift
  local urls=("$@")
  local zone_id
  local batch=()
  local url

  if [[ -z "$domain" ]]; then
    echo "Skipping Cloudflare cache purge: zone domain is not set."
    return 0
  fi

  if [[ ${#urls[@]} -eq 0 ]]; then
    echo "Skipping Cloudflare cache purge: no URLs were provided."
    return 0
  fi

  if [[ -z "${TF_VAR_cloudflare_api_token:-}" || -z "${TF_VAR_cloudflare_account_id:-}" ]]; then
    echo "Skipping Cloudflare cache purge: Cloudflare credentials are missing."
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    echo "Skipping Cloudflare cache purge: curl and jq are required."
    return 0
  fi

  echo "Resolving Cloudflare zone for $domain..."
  zone_id="$(_resolve_cloudflare_zone_id "$domain")"

  if [[ -z "$zone_id" ]]; then
    echo "Skipping Cloudflare cache purge: could not resolve zone id for $domain."
    return 0
  fi

  echo "Purging Cloudflare cache for ${#urls[@]} URL(s) in $domain..."
  for url in "${urls[@]}"; do
    batch+=("$url")
    if [[ ${#batch[@]} -lt 30 ]]; then
      continue
    fi
    _purge_cloudflare_batch "$zone_id" "${batch[@]}"
    batch=()
  done

  if [[ ${#batch[@]} -gt 0 ]]; then
    _purge_cloudflare_batch "$zone_id" "${batch[@]}"
  fi
}

# Purge one batch. Always returns 0: a purge is best-effort, and the deploy
# scripts call into here bare under `set -e`, so any non-zero status — a DNS or
# TLS failure, a non-JSON error page — would abort a deploy whose artifacts are
# already live.
_purge_cloudflare_batch() {
  local zone_id="$1"
  shift
  local payload response

  if ! payload="$(printf '%s\n' "$@" | jq -R . | jq -cs '{files: .}')"; then
    echo "  Cloudflare cache purge skipped for $# URL(s) (continuing): could not build request."
    return 0
  fi

  if ! response="$(
    curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
      -H "Authorization: Bearer ${TF_VAR_cloudflare_api_token}" \
      -H "Content-Type: application/json" \
      --data "$payload"
  )"; then
    echo "  Cloudflare cache purge request failed for $# URL(s) (continuing)."
    return 0
  fi

  if jq -e '.success == true' <<< "$response" >/dev/null 2>&1; then
    echo "  Purged $# URL(s)."
  else
    echo "  Cloudflare cache purge failed for $# URL(s) (continuing):"
    jq -c . <<< "$response" 2>/dev/null || echo "  (unparseable response)"
  fi

  return 0
}

# Best-effort Cloudflare cache purge for a set of hosts in the given zone domain.
# Covers the entry points whose contents change while their URLs stay stable.
# Usage:
#   purge_cloudflare_cache_for_hosts <zone-domain> <host1> [host2 ...]
# Example:
#   purge_cloudflare_cache_for_hosts "tearleads.com" "tearleads.com" "app.tearleads.com"
purge_cloudflare_cache_for_hosts() {
  local domain="$1"
  shift
  local hosts=("$@")
  local files=()
  local host

  if [[ ${#hosts[@]} -eq 0 ]]; then
    echo "Skipping Cloudflare cache purge: no hosts were provided."
    return 0
  fi

  for host in "${hosts[@]}"; do
    files+=(
      "https://${host}/"
      "https://${host}/index.html"
      "https://${host}/favicon.svg"
      "https://${host}/favicon.ico"
      "https://${host}/apple-touch-icon.png"
      "https://${host}/manifest.webmanifest"
    )
    if [[ "$host" == app.* || "$host" == app-*.* || "$host" == demo.* || "$host" == demo-*.* ]]; then
      files+=(
        "https://${host}/sw.js"
        "https://${host}/registerSW.js"
      )
    fi
  done

  purge_cloudflare_cache_for_urls "$domain" "${files[@]}"
}

# Best-effort Cloudflare purge of the website's non-content-addressed surface.
# Usage:
#   purge_cloudflare_website <zone-domain> <host> <dist-dir>
#
# Purges exactly what a deploy can change without changing its URL:
#
#   * HTML pages — now edge-cacheable (see the cache ruleset in
#     terraform/modules/cloudflare-website-cache), so without this the edge
#     serves the previous build for the whole `s-maxage` window.
#   * The screenshot gallery manifest — the indirection that publishes new
#     image URLs.
#
# Everything else under dist is content-addressed — Astro's hashed `_astro/`
# output, and gallery images keyed on a digest by buildScreenshots.ts — so a
# change there is a new URL that nothing can have cached, and purging it would
# spend request quota to no effect.
purge_cloudflare_website() {
  local domain="$1"
  local host="$2"
  local dist_dir="${3%/}"
  local manifest="$dist_dir/screenshot-gallery/manifest.json"
  local urls=()
  local file relative route

  if [[ ! -d "$dist_dir" ]]; then
    echo "Skipping website purge: $dist_dir does not exist."
    return 0
  fi

  # Astro emits `<route>/index.html`. Purge both that path and the directory
  # URL a visitor actually requests, since either can be the edge cache key.
  while IFS= read -r file; do
    relative="${file#"$dist_dir"}"
    urls+=("https://${host}${relative}")
    route="${relative%index.html}"
    if [[ "$route" != "$relative" ]]; then
      urls+=("https://${host}${route}")
    fi
  done < <(find "$dist_dir" -type f -name '*.html' | sort)

  if [[ -f "$manifest" ]]; then
    urls+=("https://${host}/screenshot-gallery/manifest.json")
  fi

  if [[ ${#urls[@]} -eq 0 ]]; then
    echo "Skipping website purge: nothing cacheable was built."
    return 0
  fi

  purge_cloudflare_cache_for_urls "$domain" "${urls[@]}"
}
