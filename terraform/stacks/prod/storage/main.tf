resource "cloudflare_r2_bucket" "blobs" {
  account_id = var.cloudflare_account_id
  name       = "tearleads-blobs-prod"
  location   = "enam"
  lifecycle {
    prevent_destroy = true
  }
}

module "storage" {
  source      = "../../../modules/r2-object-storage"
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.blobs.name
}
