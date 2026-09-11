output "api_storage" {
  description = "Private Ansible configuration for the AWS S3 blob store"
  sensitive   = true
  value = {
    blob_storage_managed      = true
    blob_object_store         = "s3"
    blob_s3_bucket            = var.bucket.id
    blob_s3_region            = var.bucket.region
    blob_s3_endpoint          = ""
    blob_s3_force_path_style  = false
    blob_s3_access_key_id     = aws_iam_access_key.api.id
    blob_s3_secret_access_key = aws_iam_access_key.api.secret
    blob_s3_key_prefix        = ""
  }
  depends_on = [
    aws_s3_bucket_public_access_block.blobs,
    aws_s3_bucket_ownership_controls.blobs,
    aws_s3_bucket_server_side_encryption_configuration.blobs,
    aws_s3_bucket_lifecycle_configuration.blobs,
    aws_s3_bucket_policy.tls
  ]
}
