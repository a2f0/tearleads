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

variable "vpn_access_group_name" {
  description = "Tailscale ACL group name (without the group: prefix)"
  type        = string
  default     = "vpn-access"
}

variable "vpn_gateway_tag" {
  description = "Tailscale tag for VPN gateway devices"
  type        = string
  default     = "tag:vpn-gateway"
}

variable "vpn_access_member_emails" {
  description = "User emails included in the policy-defined Tailscale VPN access group"
  type        = list(string)
  default     = []
}

variable "create_vpn_gateway_auth_key" {
  description = "Whether to create a reusable tagged auth key for VPN gateway bootstrapping"
  type        = bool
  default     = false
}

variable "vpn_gateway_auth_key_expiry_seconds" {
  description = "Auth key expiry in seconds"
  type        = number
  default     = 7776000
}

variable "overwrite_existing_acl" {
  description = "Whether Terraform may overwrite an existing tailnet policy without import"
  type        = bool
  default     = true
}
