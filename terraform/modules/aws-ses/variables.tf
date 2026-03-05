variable "domain" {
  description = "Sender domain for SES (e.g. mail.tearleads.com)"
  type        = string
}

variable "environment" {
  description = "Environment name (staging, prod)"
  type        = string
}

variable "iam_user_name" {
  description = "IAM user name for SMTP sending"
  type        = string
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
