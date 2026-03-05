output "smtp_host" {
  description = "SES SMTP endpoint for K8s config"
  value       = module.ses.smtp_host
}

output "smtp_username" {
  description = "SES SMTP username (IAM access key ID)"
  value       = module.ses.smtp_username
}

output "smtp_password" {
  description = "SES SMTP password (add to .secrets/staging.env as SES_SMTP_PASS)"
  value       = module.ses.smtp_password
  sensitive   = true
}

output "domain_identity_arn" {
  description = "SES domain identity ARN"
  value       = module.ses.domain_identity_arn
}
