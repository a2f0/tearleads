variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token for DNS management"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "ssh_key_name" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
}

variable "domain" {
  description = "DNS zone name for the Cloudflare managed domain"
  type        = string
}

variable "dns_hostname" {
  description = "DNS hostname to point at the Tuxedo server"
  type        = string
  default     = "tuxedo"
}

variable "server_location" {
  # Location options: hel1 (Helsinki), fsn1, nbg1, ash, sin.
  description = "Hetzner server location."
  type        = string
  default     = "hel1"
}

variable "server_name" {
  description = "Name for the Tuxedo server"
  type        = string
  default     = "tuxedo"
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx23"
}

variable "server_image" {
  description = "Hetzner image slug"
  type        = string
  default     = "ubuntu-24.04"
}

variable "server_username" {
  description = "Non-root username for server access"
  type        = string
}

variable "ssh_host_private_key" {
  description = "Persistent SSH host ed25519 private key for stable server identity"
  type        = string
  sensitive   = true
}

variable "ssh_host_public_key" {
  description = "Persistent SSH host ed25519 public key for known_hosts"
  type        = string
}
