mock_provider "cloudflare" {}

variables {
  account_id  = "11111111111111111111111111111111"
  bucket_name = "tearleads-blobs-staging"
}

run "private_blobs" {
  command = plan
  assert {
    condition = (
      !cloudflare_r2_managed_domain.storage.enabled &&
      length(cloudflare_r2_custom_domain.downloads) == 0 &&
      output.download_base_url == null
    )
    error_message = "Application blobs must have no public domain."
  }
  assert {
    condition = (
      cloudflare_account_token.objects.policies[0].effect == "allow" &&
      length(cloudflare_account_token.objects.policies[0].permission_groups) == 1 &&
      cloudflare_account_token.objects.policies[0].permission_groups[0].id == "2efd5506f9c8494dacb1fa10a3e7d5b6" &&
      jsondecode(cloudflare_account_token.objects.policies[0].resources) == {
        "com.cloudflare.edge.r2.bucket.11111111111111111111111111111111_default_tearleads-blobs-staging" = "*"
      }
    )
    error_message = "Credentials must be scoped to object access in this bucket only."
  }
  assert {
    condition = (
      cloudflare_r2_bucket_lifecycle.storage.rules[0].enabled &&
      cloudflare_r2_bucket_lifecycle.storage.rules[0].abort_multipart_uploads_transition.condition.max_age == 604800 &&
      cloudflare_r2_bucket_lifecycle.storage.rules[0].delete_objects_transition == null
    )
    error_message = "Only abandoned multipart uploads should expire, after seven days."
  }
}

run "public_downloads" {
  command = plan
  variables {
    bucket_name = "tearleads-downloads-prod"
    public_domain = {
      hostname = "downloads.example.test"
      zone_id  = "22222222222222222222222222222222"
    }
  }
  assert {
    condition = (
      !cloudflare_r2_managed_domain.storage.enabled &&
      cloudflare_r2_custom_domain.downloads[0].enabled &&
      cloudflare_r2_custom_domain.downloads[0].min_tls == "1.2" &&
      cloudflare_r2_custom_domain.downloads[0].bucket_name == var.bucket_name &&
      output.download_base_url == "https://downloads.example.test"
    )
    error_message = "Downloads must use their configured HTTPS custom domain."
  }
}

run "signed_blob_transfer_cors" {
  command = plan
  variables {
    download_cors_origins = ["*"]
  }
  assert {
    condition = (
      cloudflare_r2_bucket_cors.downloads[0].bucket_name == var.bucket_name &&
      toset(cloudflare_r2_bucket_cors.downloads[0].rules[0].allowed.origins) == toset(["*"]) &&
      toset(cloudflare_r2_bucket_cors.downloads[0].rules[0].allowed.methods) == toset(["GET", "PUT"]) &&
      contains(cloudflare_r2_bucket_cors.downloads[0].rules[0].allowed.headers, "Content-MD5") &&
      contains(cloudflare_r2_bucket_cors.downloads[0].rules[0].expose_headers, "ETag") &&
      cloudflare_r2_bucket_cors.downloads[0].rules[0].max_age_seconds == 300 &&
      !cloudflare_r2_managed_domain.storage.enabled &&
      length(cloudflare_r2_custom_domain.downloads) == 0
    )
    error_message = "Browser blob transfers require GET/PUT CORS without making the bucket public."
  }
}
