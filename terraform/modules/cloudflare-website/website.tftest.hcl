mock_provider "cloudflare" {}

override_data {
  target = data.cloudflare_zone.website
  values = { id = "11111111111111111111111111111111" }
}

variables {
  cloudflare_account_id = "22222222222222222222222222222222"
  domain                = "example.test"
  hostname              = "example.test"
  worker_name           = "tearleads-website-prod"
}

run "production_domain" {
  command = plan
  assert {
    condition = (
      data.cloudflare_zone.website.filter.account.id == var.cloudflare_account_id &&
      data.cloudflare_zone.website.filter.name == var.domain &&
      cloudflare_workers_custom_domain.website.account_id == var.cloudflare_account_id &&
      cloudflare_workers_custom_domain.website.zone_id == "11111111111111111111111111111111" &&
      cloudflare_workers_custom_domain.website.hostname == "example.test" &&
      cloudflare_workers_custom_domain.website.service == "tearleads-website-prod" &&
      output.url == "https://example.test"
    )
    error_message = "The website domain must attach to its published Worker in the configured account and zone."
  }
}

run "staging_domain" {
  command = plan
  variables {
    hostname    = "website-staging.example.test"
    worker_name = "tearleads-website-staging"
  }
  assert {
    condition = (
      cloudflare_workers_custom_domain.website.hostname == "website-staging.example.test" &&
      output.worker_name == "tearleads-website-staging" &&
      output.url == "https://website-staging.example.test"
    )
    error_message = "Staging must publish its own website and hostname."
  }
}
