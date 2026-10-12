output "connection" {
  description = "Bucket-scoped credentials for R2's S3 API"
  sensitive   = true
  value = {
    bucket            = var.bucket_name
    endpoint          = "https://${var.account_id}.r2.cloudflarestorage.com"
    region            = "auto"
    access_key_id     = cloudflare_account_token.objects.id
    secret_access_key = sha256(cloudflare_account_token.objects.value)
  }
  depends_on = [cloudflare_r2_managed_domain.storage, cloudflare_r2_bucket_lifecycle.storage]
}
output "download_base_url" {
  description = "Public download origin, or null for private application storage"
  value       = var.public_domain == null ? null : "https://${cloudflare_r2_custom_domain.downloads[0].domain}"
}
