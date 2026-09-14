output "download_base_url" {
  description = "Public HTTPS S3 URL; append an object key to download a release"
  # Path-style HTTPS avoids S3's wildcard certificate mismatch for dotted names.
  value = "https://s3.${var.bucket.region}.amazonaws.com/${var.bucket.id}"
  depends_on = [
    aws_s3_bucket_policy.downloads,
    aws_s3_bucket_ownership_controls.downloads,
    aws_s3_bucket_server_side_encryption_configuration.downloads,
    aws_s3_bucket_lifecycle_configuration.downloads
  ]
}
