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
locals {
  website_cache_hostnames = distinct(concat([var.hostname], var.additional_hostnames))
}

resource "cloudflare_ruleset" "website_cache" {
  zone_id = var.zone_id
  name    = "Website edge cache"
  kind    = "zone"
  phase   = "http_request_cache_settings"

  # Each hostname gets two mutually exclusive rules, split on whether the query
  # string is part of the resource's identity. A zone supports one ruleset for
  # this phase, so production also owns rules for staging when they share a zone.
  rules = flatten([
    for index, hostname in local.website_cache_hostnames : [
      {
        ref         = index == 0 ? "website_gallery_edge_cache" : "website_gallery_edge_cache_${replace(hostname, ".", "_")}"
        description = "Cache ${hostname} screenshot gallery, keyed including ?v="
        expression  = "(http.host eq \"${hostname}\" and starts_with(http.request.uri.path, \"/screenshot-gallery/\"))"
        action      = "set_cache_settings"
        enabled     = true

        action_parameters = {
          cache       = true
          edge_ttl    = { mode = "respect_origin" }
          browser_ttl = { mode = "respect_origin" }
        }
      },
      {
        ref         = index == 0 ? "website_html_edge_cache" : "website_html_edge_cache_${replace(hostname, ".", "_")}"
        description = "Cache ${hostname} pages, ignoring query strings"
        expression  = "(http.host eq \"${hostname}\" and not starts_with(http.request.uri.path, \"/screenshot-gallery/\"))"
        action      = "set_cache_settings"
        enabled     = true

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
  ])
}
