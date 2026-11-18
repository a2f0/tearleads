variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}
variable "cloudflare_account_id" {
  type = string
}
variable "domain" {
  type = string
}

locals {
  balebase_challenge_pattern = "^balebase-verification=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
}

variable "balebase_verification_txt" {
  description = "Full TXT value issued for this zone by the Tearleads workspace in Balebase."
  type        = string
  default     = null

  validation {
    condition = var.balebase_verification_txt == null || can(regex(
      local.balebase_challenge_pattern,
      var.balebase_verification_txt
    ))
    error_message = "Copy the complete balebase-verification=<uuid> value from Balebase."
  }
}

variable "balebase_subdomain_verification_txt" {
  description = "Full TXT value issued by Balebase for base.<domain>."
  type        = string
  default     = null

  validation {
    condition = var.balebase_subdomain_verification_txt == null || (
      var.balebase_subdomain_verification_txt != var.balebase_verification_txt &&
      can(regex(local.balebase_challenge_pattern, var.balebase_subdomain_verification_txt))
    )
    error_message = "Copy the separate balebase-verification=<uuid> value for the base subdomain."
  }
}

variable "enable_balebase_subdomain_mx" {
  description = "Set false to enroll or withdraw the subdomain, or true after its Balebase recipient is ready."
  type        = bool
  default     = null

  validation {
    condition = (
      var.balebase_subdomain_verification_txt == null
      ? var.enable_balebase_subdomain_mx != true
      : var.enable_balebase_subdomain_mx != null
    )
    error_message = "With a child TXT challenge, set the MX switch explicitly to true or false. Enable it only after verification and binding."
  }
}
