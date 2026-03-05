variable "domain" {
  description = "SES sender domain"
  type        = string
  default     = "mail.tearleads.com"
}

variable "dns_domain" {
  description = "Apex domain for Cloudflare zone lookup"
  type        = string
  default     = "tearleads.com"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}
