variable "tailscale_tailnet_id" {
  description = "Tailnet ID (recommended) or tailnet name for the Tailscale API provider"
  type        = string
}

variable "tailscale_api_token" {
  description = "Tailscale API token (tskey-api-...)"
  type        = string
  sensitive   = true
}

variable "tailscale_base_url" {
  description = "Optional Tailscale API base URL"
  type        = string
  default     = "https://api.tailscale.com"
}

variable "staging_access_member_emails" {
  description = "User emails with access to staging resources"
  type        = list(string)
  default     = []
}

variable "prod_access_member_emails" {
  description = "User emails with access to production resources"
  type        = list(string)
  default     = []
}

variable "create_staging_vault_auth_key" {
  description = "Whether to create a reusable tagged auth key for staging Vault"
  type        = bool
  default     = true
}

variable "create_prod_vault_auth_key" {
  description = "Whether to create a reusable tagged auth key for production Vault"
  type        = bool
  default     = true
}

variable "auth_key_expiry_seconds" {
  description = "Auth key expiry in seconds (default 90 days)"
  type        = number
  default     = 7776000
}

variable "overwrite_existing_acl" {
  description = "Whether Terraform may overwrite an existing tailnet policy without import"
  type        = bool
  default     = true
}
