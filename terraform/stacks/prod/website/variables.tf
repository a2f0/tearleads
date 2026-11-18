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
  description = "Publish the MX for base.<domain> after Balebase verifies and binds its recipient."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.enable_balebase_subdomain_mx || var.balebase_subdomain_verification_txt != null
    error_message = "Configure the base subdomain's own verification TXT before enabling its MX."
  }
}
