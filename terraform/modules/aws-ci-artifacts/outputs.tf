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
  value       = var.enable_ci_user ? aws_iam_user.ci[0].name : null
}

output "ci_user_arn" {
  description = "IAM user ARN for CI"
  value       = var.enable_ci_user ? aws_iam_user.ci[0].arn : null
}

output "ci_access_key_id" {
  description = "IAM access key ID for CI"
  value       = var.enable_ci_user ? aws_iam_access_key.ci[0].id : null
}

output "ci_secret_access_key" {
  description = "IAM secret access key for CI (sensitive)"
  value       = var.enable_ci_user ? aws_iam_access_key.ci[0].secret : null
  sensitive   = true
}

output "ecr_repository_urls" {
  description = "Map of ECR repository names to URLs"
  value       = { for name, repo in aws_ecr_repository.repos : name => repo.repository_url }
}

output "ecr_repository_arns" {
  description = "Map of ECR repository names to ARNs"
  value       = { for name, repo in aws_ecr_repository.repos : name => repo.arn }
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC role ARN for CI"
  value       = var.create_github_actions_role ? aws_iam_role.github_actions[0].arn : null
}

output "github_actions_oidc_provider_arn" {
  description = "GitHub OIDC provider ARN used by the CI role"
  value = var.create_github_actions_role ? (
    var.github_actions_oidc_provider_arn != null ? var.github_actions_oidc_provider_arn : aws_iam_openid_connect_provider.github_actions[0].arn
  ) : null
}
