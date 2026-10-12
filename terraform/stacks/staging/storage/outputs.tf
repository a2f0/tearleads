output "bucket" {
  description = "Cloudflare R2 bucket identity"
  value = {
    name       = cloudflare_r2_bucket.blobs.name
    account_id = var.cloudflare_account_id
  }
}

output "api_storage" {
  description = "Private API configuration for R2's S3 protocol"
  sensitive   = true
  value = {
    blob_object_store         = "s3"
    blob_s3_bucket            = module.storage.connection.bucket
    blob_s3_region            = module.storage.connection.region
    blob_s3_endpoint          = module.storage.connection.endpoint
    blob_s3_force_path_style  = true
    blob_s3_access_key_id     = module.storage.connection.access_key_id
    blob_s3_secret_access_key = module.storage.connection.secret_access_key
  }
}
