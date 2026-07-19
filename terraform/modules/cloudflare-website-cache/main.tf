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

  rules = [{
    ref         = "website_html_edge_cache"
    description = "Cache ${var.hostname} at the edge using origin cache headers"
    # Scoped to the website host alone. The zone also fronts api., app.,
    # code-assist., and demo. through the same tunnel; making those
    # cache-eligible would serve API responses and authenticated app shells
    # from the edge.
    expression = "(http.host eq \"${var.hostname}\")"
    action     = "set_cache_settings"
    enabled    = true

    action_parameters = {
      cache = true

      edge_ttl = {
        mode = "respect_origin"
      }

      browser_ttl = {
        mode = "respect_origin"
      }
    }
  }]
}
