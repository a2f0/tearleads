variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
}

variable "staging_domain" {
  description = "Staging domain name for DNS records (k8s subdomain will be created)"
  type        = string
}

variable "server_location" {
  description = "Hetzner server location (hel1, fsn1, nbg1, ash, sin)"
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
  default     = "cx22"
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed to access SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "allowed_k8s_api_ips" {
  description = "List of IP addresses/CIDRs allowed to access k8s API (port 6443)"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"] # More permissive for staging dev access
}
