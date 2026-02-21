variable "name" {
  description = "Name of the server"
  type        = string
}

variable "ssh_key_id" {
  description = "ID of existing SSH key in Hetzner"
  type        = string
}

variable "server_type" {
  description = "Hetzner server type (e.g., cx22, cx32, cx42)"
  type        = string
  default     = "cx23"
}

variable "image" {
  description = "Server image"
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "hel1"
}

variable "user_data" {
  description = "Cloud-init user data"
  type        = string
  default     = ""
}

variable "labels" {
  description = "Labels to apply to resources"
  type        = map(string)
  default     = {}
}

variable "create_firewall" {
  description = "Whether to create a firewall for this server"
  type        = bool
  default     = true
}

variable "firewall_rules" {
  description = "List of firewall rules"
  type = list(object({
    direction  = string
    protocol   = string
    port       = optional(string)
    source_ips = list(string)
  }))
  default = []
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed SSH access"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}
