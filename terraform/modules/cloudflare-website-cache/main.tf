# Makes the marketing site's HTML eligible for Cloudflare's edge cache.
#
# Cloudflare caches static assets by extension out of the box but never HTML,
# regardless of what the origin sends — so every page view fell through to the
# origin in Nuremberg (measured ~165ms TTFB from the US east coast, against
# ~50ms for an asset served from the edge). This rule closes that gap.
#
# TTLs deliberately come from the origin (`respect_origin`) rather than being
# set here, so all per-path cache policy stays in one place: the nginx site
# template. nginx sends `s-maxage` for HTML, `no-cache` for the screenshot
# gallery manifest, and `immutable` for content-hashed assets; this rule only
# grants the edge permission to honor them.
resource "cloudflare_ruleset" "website_cache" {
  zone_id = var.zone_id
  name    = "Website edge cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"

  # Two mutually exclusive rules, split on whether the query string is part of
  # the resource's identity. Order is therefore irrelevant: exactly one matches.
  rules = [
    {
      ref         = "website_gallery_edge_cache"
      description = "Cache ${var.hostname} screenshot gallery, keyed including ?v="
      # The gallery's image URLs carry a `?v=<digest>` written by
      # buildScreenshots.ts, so the query string IS the version. It must stay in
      # the cache key or every version of an image would collide on one entry.
      expression = "(http.host eq \"${var.hostname}\" and starts_with(http.request.uri.path, \"/screenshot-gallery/\"))"
      action     = "set_cache_settings"
      enabled    = true

      action_parameters = {
        cache       = true
        edge_ttl    = { mode = "respect_origin" }
        browser_ttl = { mode = "respect_origin" }
      }
    },
    {
      ref         = "website_html_edge_cache"
      description = "Cache ${var.hostname} pages, ignoring query strings"
      # Everything else is static output whose query string never changes the
      # response — campaign parameters (?utm_source=…) are the common case.
      # Cloudflare keys on the full URL by default, so each variant would be its
      # own entry that a deploy purge (which knows only canonical URLs) can
      # never reach, serving pre-deploy HTML for the whole s-maxage window.
      # Dropping the query from the key collapses them onto one purgeable entry
      # and raises the hit rate as a side effect.
      expression = "(http.host eq \"${var.hostname}\" and not starts_with(http.request.uri.path, \"/screenshot-gallery/\"))"
      action     = "set_cache_settings"
      enabled    = true

      action_parameters = {
        cache       = true
        edge_ttl    = { mode = "respect_origin" }
        browser_ttl = { mode = "respect_origin" }

        cache_key = {
          custom_key = {
            query_string = {
              exclude = { all = true }
            }
          }
        }
      }
    },
  ]
}
