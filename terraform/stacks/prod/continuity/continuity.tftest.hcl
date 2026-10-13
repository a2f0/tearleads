mock_provider "cloudflare" {}

variables {
  cloudflare_api_token  = "test-token"
  cloudflare_account_id = "22222222222222222222222222222222"
  domain                = "example.test"
}

run "gallery_domain" {
  command = plan
  assert {
    condition = (
      output.worker_name == "tearleads-continuity" &&
      output.url == "https://continuity.example.test"
    )
    error_message = "Continuity must attach its subdomain to the separately published gallery Worker."
  }
}
