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

variable "wireguard_port" {
  description = "WireGuard UDP port"
  type        = number
  default     = 51820
}

variable "vpn_network_cidr" {
  description = "CIDR for the VPN private network"
  type        = string
  default     = "10.100.0.0/16"
}

variable "vpn_subnet_cidr" {
  description = "CIDR for the VPN subnet"
  type        = string
  default     = "10.100.1.0/24"
}

variable "wireguard_client_cidr" {
  description = "CIDR for WireGuard client IPs"
  type        = string
  default     = "10.200.0.0/24"
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
