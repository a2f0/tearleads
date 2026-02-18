output "bucket_name" {
  description = "S3 bucket name"
  value       = module.ci_artifacts.bucket_name
}

output "bucket_domain_name" {
  description = "S3 bucket domain name for downloads"
  value       = module.ci_artifacts.bucket_domain_name
}

output "ci_user_name" {
  description = "IAM user name for CI"
  value       = module.ci_artifacts.ci_user_name
}

output "ci_access_key_id" {
  description = "IAM access key ID for CI (add to GitHub secrets)"
  value       = module.ci_artifacts.ci_access_key_id
}

output "ci_secret_access_key" {
  description = "IAM secret access key for CI (add to GitHub secrets)"
  value       = module.ci_artifacts.ci_secret_access_key
  sensitive   = true
}

output "ecr_repository_urls" {
  description = "ECR repository URLs for container images"
  value       = module.ci_artifacts.ecr_repository_urls
}

output "github_actions_role_arn" {
  description = "GitHub Actions OIDC role ARN for staging ECR push"
  value       = module.ci_artifacts.github_actions_role_arn
}
