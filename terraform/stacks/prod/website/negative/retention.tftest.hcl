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

run "enroll" {
  command = apply
  variables {
    balebase_verification_txt = "balebase-verification=11111111-2222-4333-8444-555555555555"
  }
}
run "omit_input" {
  command = plan
}
