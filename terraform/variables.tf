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

variable "server_location" {
  # Location options: hel1 (Helsinki), fsn1, nbg1, ash, sin.
  description = "Hetzner server location."
  type        = string
  default     = "hel1"
}

variable "server_username" {
  description = "Non-root username for server access"
  type        = string
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed to access SSH. Defaults to all for development, should be restricted in production."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
