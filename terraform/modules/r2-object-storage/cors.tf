resource "cloudflare_r2_bucket_cors" "downloads" {
  count       = length(var.download_cors_origins) > 0 ? 1 : 0
  account_id  = var.account_id
  bucket_name = var.bucket_name
  rules = [{
    id = "signed-blob-downloads"
    allowed = {
      origins = var.download_cors_origins
      methods = ["GET"]
      headers = ["Range", "If-Match", "Cache-Control"]
    }
    expose_headers  = ["Content-Length", "Content-Range", "ETag"]
    max_age_seconds = 300
  }]
}
