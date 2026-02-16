variable "HCLOUD_TOKEN" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "SSH_KEY_NAME" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
}

variable "STAGING_DOMAIN" {
  description = "Staging domain name for DNS records (k8s subdomain will be created)"
  type        = string
}

variable "SERVER_LOCATION" {
  description = "Hetzner server location (hel1, fsn1, nbg1, ash, sin)"
  type        = string
  default     = "hel1"
}

variable "SERVER_USERNAME" {
  description = "Non-root username for server access"
  type        = string
}

variable "SERVER_TYPE" {
  description = "Hetzner server type"
  type        = string
  default     = "cx23"
}

variable "ALLOWED_SSH_IPS" {
  description = "List of IP addresses/CIDRs allowed to access SSH"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "ALLOWED_K8S_API_IPS" {
  description = "List of IP addresses/CIDRs allowed to access k8s API (port 6443)"
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"] # More permissive for staging dev access
}
