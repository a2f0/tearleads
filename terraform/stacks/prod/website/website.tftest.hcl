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

run "verification_off_before_enrollment" {
  command = plan
  assert {
    condition     = length(cloudflare_dns_record.balebase_verification) == 0
    error_message = "The zone must wait for a workspace-issued TXT challenge."
  }
}

run "publish_workspace_challenge" {
  command = plan
  variables {
    balebase_verification_txt = "balebase-verification=11111111-2222-4333-8444-555555555555"
  }
  assert {
    condition = (
      cloudflare_dns_record.balebase_verification[0].zone_id == "11111111111111111111111111111111" &&
      cloudflare_dns_record.balebase_verification[0].name == "_balebase-verification.example.test" &&
      cloudflare_dns_record.balebase_verification[0].type == "TXT" &&
      cloudflare_dns_record.balebase_verification[0].content == jsonencode(var.balebase_verification_txt)
    )
    error_message = "Publish the issued value as one DNS character-string at the challenge name."
  }
}

run "reject_placeholder_challenge" {
  command = plan
  variables {
    balebase_verification_txt = "balebase-verification=<uuid>"
  }
  expect_failures = [var.balebase_verification_txt]
}
