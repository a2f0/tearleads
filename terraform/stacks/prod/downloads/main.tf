resource "cloudflare_r2_bucket" "downloads" {
  account_id = var.cloudflare_account_id
  name       = "tearleads-downloads-prod"
  location   = "enam"
  lifecycle {
    prevent_destroy = true
  }
}

data "cloudflare_zone" "downloads" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.domain
  }
}

module "downloads" {
  source      = "../../../modules/r2-object-storage"
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.downloads.name
  public_domain = {
    hostname = "downloads.${var.domain}"
    zone_id  = data.cloudflare_zone.downloads.id
  }
}
