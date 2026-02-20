variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "dns_domain" {
  description = "Apex domain managed in Cloudflare"
  type        = string
  default     = "tearleads.com"
}

variable "manage_mx_records" {
  description = "Whether to manage MX records at the apex domain"
  type        = bool
  default     = true
}

variable "mx_ttl" {
  description = "TTL for MX records (seconds)"
  type        = number
  default     = 600
}

variable "mx_records" {
  description = "MX records to manage for the apex domain"
  type = list(object({
    priority = number
    target   = string
  }))
  default = [
    {
      priority = 1
      target   = "aspmx.l.google.com."
    },
    {
      priority = 5
      target   = "alt1.aspmx.l.google.com."
    },
    {
      priority = 5
      target   = "alt2.aspmx.l.google.com."
    },
    {
      priority = 10
      target   = "aspmx2.googlemail.com."
    },
    {
      priority = 10
      target   = "aspmx3.googlemail.com."
    },
  ]
}

variable "manage_google_site_verification_records" {
  description = "Whether to manage Google site verification TXT records at apex"
  type        = bool
  default     = true
}

variable "txt_ttl" {
  description = "TTL for TXT records (seconds)"
  type        = number
  default     = 300
}

variable "google_site_verification_tokens" {
  description = "Google site verification TXT values"
  type        = set(string)
  default = [
    "google-site-verification=-U0LmlFws7EMjM8T1_HE3JFm1yrPFBscL-MT2n7y9RY",
    "google-site-verification=nIgRjHZv6Eaf78a8KhqGk7lJsBUndJBNoioOYluKsbo",
  ]
}
