output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.vfs_blobs.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.vfs_blobs.arn
}

output "access_key_id" {
  description = "IAM access key ID for the vfs-blobs user"
  value       = aws_iam_access_key.vfs_blobs.id
  sensitive   = true
}

output "secret_access_key" {
  description = "IAM secret access key for the vfs-blobs user"
  value       = aws_iam_access_key.vfs_blobs.secret
  sensitive   = true
}
