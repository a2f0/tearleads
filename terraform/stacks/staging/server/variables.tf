variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
}

variable "domain" {
  description = "Domain name for DNS records"
  type        = string
}

variable "extra_demo_domains" {
  description = "Additional Cloudflare zone names that should route demo.<domain> to this server."
  type        = list(string)
  default     = []
}

variable "server_location" {
  description = "Hetzner server location"
  type        = string
  default     = "hel1"
}

variable "server_username" {
  description = "Non-root username for server access"
  type        = string
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx23"
}

variable "server_user_data" {
  description = "Cloud-init user data (empty uses built-in with Tailscale)"
  type        = string
  default     = ""
}

variable "ssh_host_private_key" {
  description = "SSH host private key for the server"
  type        = string
  sensitive   = true
}

variable "ssh_host_public_key" {
  description = "SSH host public key for the server"
  type        = string
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

variable "cloudflare_tunnel_destroy_grace_seconds" {
  description = "Seconds to wait after the staging server is destroyed before deleting the Cloudflare tunnel, allowing stale tunnel connections to close."
  type        = number
  default     = 90

  validation {
    condition     = var.cloudflare_tunnel_destroy_grace_seconds >= 0 && var.cloudflare_tunnel_destroy_grace_seconds <= 600
    error_message = "cloudflare_tunnel_destroy_grace_seconds must be between 0 and 600."
  }
}

variable "tailscale_api_token" {
  description = "Tailscale API token for destroy-time device cleanup"
  type        = string
  sensitive   = true
}

variable "tailscale_auth_key" {
  description = "Tailscale auth key for server registration"
  type        = string
  sensitive   = true
}

variable "tailscale_tailnet_id" {
  description = "Tailscale tailnet name for device cleanup"
  type        = string
}
