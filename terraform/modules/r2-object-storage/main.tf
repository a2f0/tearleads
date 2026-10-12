# Never expose private blobs or downloads through the unmanaged r2.dev endpoint.
resource "cloudflare_r2_managed_domain" "storage" {
  account_id  = var.account_id
  bucket_name = var.bucket_name
  enabled     = false
}

resource "cloudflare_r2_bucket_lifecycle" "storage" {
  account_id  = var.account_id
  bucket_name = var.bucket_name
  rules = [{
    id         = "abort-abandoned-multipart-uploads"
    enabled    = true
    conditions = { prefix = "" }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 7 * 24 * 60 * 60 }
    }
  }]
}

resource "cloudflare_account_token" "objects" {
  account_id = var.account_id
  name       = "${var.bucket_name}-objects"
  policies = [{
    effect = "allow"
    # Workers R2 Storage Bucket Item Write: object access, no bucket administration.
    permission_groups = [{ id = "2efd5506f9c8494dacb1fa10a3e7d5b6" }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${var.bucket_name}" = "*"
    })
  }]
}

resource "cloudflare_r2_custom_domain" "downloads" {
  count       = var.public_domain == null ? 0 : 1
  account_id  = var.account_id
  bucket_name = var.bucket_name
  domain      = var.public_domain.hostname
  zone_id     = var.public_domain.zone_id
  enabled     = true
  min_tls     = "1.2"
}
