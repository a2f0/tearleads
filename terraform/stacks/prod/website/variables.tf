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

variable "balebase_verification_txt" {
  description = "Full TXT value issued for this zone by the Tearleads workspace in Balebase."
  type        = string
  default     = null

  validation {
    condition = var.balebase_verification_txt == null || can(regex(
      "^balebase-verification=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      var.balebase_verification_txt
    ))
    error_message = "Copy the complete balebase-verification=<uuid> value from Balebase."
  }
}
