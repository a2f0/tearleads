data "aws_region" "current" {}

# COMPLIANCE_SENTINEL: TL-EMAIL-001 | control=ses-domain-identity
resource "aws_ses_domain_identity" "this" {
  domain = var.domain
}

# COMPLIANCE_SENTINEL: TL-EMAIL-002 | control=ses-dkim-signing
resource "aws_ses_domain_dkim" "this" {
  domain = aws_ses_domain_identity.this.domain
}

# COMPLIANCE_SENTINEL: TL-EMAIL-003 | control=ses-smtp-iam-user
resource "aws_iam_user" "smtp" {
  name = var.iam_user_name

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "ses-smtp"
  })
}

# COMPLIANCE_SENTINEL: TL-EMAIL-004 | control=ses-send-policy
resource "aws_iam_user_policy" "smtp_send" {
  name = "${var.iam_user_name}-ses-send"
  user = aws_iam_user.smtp.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = aws_ses_domain_identity.this.arn
      }
    ]
  })
}

# COMPLIANCE_SENTINEL: TL-EMAIL-005 | control=ses-smtp-credentials
resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}
