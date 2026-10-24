mock_provider "cloudflare" {}

override_data {
  target = module.website.data.cloudflare_zone.website
  values = { id = "11111111111111111111111111111111" }
}

variables {
  cloudflare_api_token  = "test-token"
  cloudflare_account_id = "22222222222222222222222222222222"
  domain                = "example.test"
}

run "apex_domain_and_https_redirect" {
  command = plan
  assert {
    condition = (
      output.worker_name == "tearleads-website-prod" &&
      output.url == "https://example.test"
    )
    error_message = "Production must attach the apex domain to its website Worker."
  }
  assert {
    condition = (
      cloudflare_zone_setting.always_use_https.zone_id == "11111111111111111111111111111111" &&
      cloudflare_zone_setting.always_use_https.setting_id == "always_use_https" &&
      cloudflare_zone_setting.always_use_https.value == "on"
    )
    error_message = "Production must turn on Always Use HTTPS for the website's zone."
  }
}
