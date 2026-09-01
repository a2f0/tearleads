mock_provider "cloudflare" {}

run "primary_hostname_rules" {
  command = plan

  variables {
    zone_id              = "00000000000000000000000000000000"
    hostname             = "tearleads.com"
    additional_hostnames = []
  }

  assert {
    condition     = length(cloudflare_ruleset.website_cache.rules) == 2
    error_message = "A primary hostname must produce one gallery rule and one HTML rule."
  }

  assert {
    condition = (
      cloudflare_ruleset.website_cache.rules[0].ref == "website_gallery_edge_cache" &&
      cloudflare_ruleset.website_cache.rules[1].ref == "website_html_edge_cache"
    )
    error_message = "Primary hostname refs must remain stable for state-safe updates."
  }

  assert {
    condition = (
      cloudflare_ruleset.website_cache.rules[0].action_parameters.cache_key == null &&
      cloudflare_ruleset.website_cache.rules[1].action_parameters.cache_key.custom_key.query_string.exclude.all
    )
    error_message = "Gallery rules must preserve query strings and HTML rules must ignore them."
  }
}

run "additional_hostnames_are_deduplicated" {
  command = plan

  variables {
    zone_id  = "00000000000000000000000000000000"
    hostname = "tearleads.com"
    additional_hostnames = [
      "website-staging.tearleads.com",
      "website-staging.tearleads.com",
      "tearleads.com",
    ]
  }

  assert {
    condition     = length(cloudflare_ruleset.website_cache.rules) == 4
    error_message = "Duplicate primary and additional hostnames must produce only one rule pair each."
  }

  assert {
    condition = (
      cloudflare_ruleset.website_cache.rules[2].ref == "website_gallery_edge_cache_website-staging_tearleads_com" &&
      cloudflare_ruleset.website_cache.rules[3].ref == "website_html_edge_cache_website-staging_tearleads_com"
    )
    error_message = "Additional hostname refs must be deterministic and unique."
  }

  assert {
    condition = (
      cloudflare_ruleset.website_cache.rules[2].action_parameters.cache_key == null &&
      cloudflare_ruleset.website_cache.rules[3].action_parameters.cache_key.custom_key.query_string.exclude.all
    )
    error_message = "Every additional hostname must retain both cache-key policies."
  }
}
