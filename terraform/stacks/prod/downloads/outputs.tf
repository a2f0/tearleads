output "bucket" {
  description = "Cloudflare R2 bucket identity"
  value = {
    name       = cloudflare_r2_bucket.downloads.name
    account_id = var.cloudflare_account_id
  }
}

output "download_base_url" {
  description = "Public HTTPS origin for Electrobun release downloads"
  value       = module.downloads.download_base_url
}
output "release_storage" {
  description = "Private R2 credentials for desktop release publication"
  sensitive   = true
  value       = module.downloads.connection
}
