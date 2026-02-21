variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
}

variable "server_username" {
  description = "Non-root username for server access"
  type        = string
}

variable "server_location" {
  description = "Hetzner server location"
  type        = string
  default     = "hel1"
}

variable "server_type" {
  description = "Hetzner server type"
  type        = string
  default     = "cx23"
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed to access SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "tailscale_api_token" {
  description = "Tailscale API token for device management"
  type        = string
  sensitive   = true
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

variable "enable_userpass_auth" {
  description = "Enable Vault userpass auth backend and file-reader policy management"
  type        = bool
  default     = false
}

variable "vault_bootstrap_username" {
  description = "Optional initial userpass username to create (requires vault_bootstrap_password)"
  type        = string
  default     = ""

  validation {
    condition = (
      (var.vault_bootstrap_username == "" && var.vault_bootstrap_password == "") ||
      (var.vault_bootstrap_username != "" && var.vault_bootstrap_password != "")
    )
    error_message = "vault_bootstrap_username and vault_bootstrap_password must both be set or both be empty."
  }
}

variable "vault_bootstrap_password" {
  description = "Optional initial userpass password to create (sensitive; requires vault_bootstrap_username)"
  type        = string
  sensitive   = true
  default     = ""
}
