output "smtp_host" {
  description = "SES SMTP endpoint"
  value       = "email-smtp.${data.aws_region.current.name}.amazonaws.com"
}

output "smtp_port" {
  description = "SES SMTP port (STARTTLS)"
  value       = "587"
}

output "smtp_username" {
  description = "SMTP username (IAM access key ID)"
  value       = aws_iam_access_key.smtp.id
}

output "smtp_password" {
  description = "SMTP password (SES-specific password derived from secret key)"
  value       = aws_iam_access_key.smtp.ses_smtp_password_v4
  sensitive   = true
}

output "domain_verification_token" {
  description = "TXT record value for SES domain verification"
  value       = aws_ses_domain_identity.this.verification_token
}

output "dkim_tokens" {
  description = "DKIM CNAME token values (3 records needed)"
  value       = aws_ses_domain_dkim.this.dkim_tokens
}

output "domain_identity_arn" {
  description = "SES domain identity ARN"
  value       = aws_ses_domain_identity.this.arn
}
