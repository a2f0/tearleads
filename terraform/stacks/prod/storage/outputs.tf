output "bucket" {
  description = "Blob bucket identity and region"
  value = {
    name   = aws_s3_bucket.blobs.id
    arn    = aws_s3_bucket.blobs.arn
    region = aws_s3_bucket.blobs.region
  }
}

output "api_storage" {
  description = "Private Ansible blob storage configuration"
  sensitive   = true
  value       = module.storage.api_storage
}
