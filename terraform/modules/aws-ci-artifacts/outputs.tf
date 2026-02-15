output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.artifacts.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.artifacts.arn
}

output "bucket_domain_name" {
  description = "S3 bucket domain name"
  value       = aws_s3_bucket.artifacts.bucket_domain_name
}

output "bucket_regional_domain_name" {
  description = "S3 bucket regional domain name"
  value       = aws_s3_bucket.artifacts.bucket_regional_domain_name
}

output "ci_user_name" {
  description = "IAM user name for CI"
  value       = aws_iam_user.ci.name
}

output "ci_user_arn" {
  description = "IAM user ARN for CI"
  value       = aws_iam_user.ci.arn
}

output "ci_access_key_id" {
  description = "IAM access key ID for CI"
  value       = aws_iam_access_key.ci.id
}

output "ci_secret_access_key" {
  description = "IAM secret access key for CI (sensitive)"
  value       = aws_iam_access_key.ci.secret
  sensitive   = true
}
