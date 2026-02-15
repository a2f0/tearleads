variable "domain" {
  description = "Domain name for DNS records"
  type        = string
}

variable "ipv4_address" {
  description = "IPv4 address for DNS records"
  type        = string
}

variable "ipv6_address" {
  description = "IPv6 address for DNS records"
  type        = string
}

variable "create_apex_records" {
  description = "Whether to create apex (root) DNS records"
  type        = bool
  default     = true
}

variable "subdomains" {
  description = "List of subdomains to create A/AAAA records for"
  type        = set(string)
  default     = []
}

variable "wildcard_subdomain" {
  description = "Subdomain to create wildcard records for (e.g., 'k8s' creates *.k8s)"
  type        = string
  default     = ""
}

variable "create_mx_records" {
  description = "Whether to create MX records"
  type        = bool
  default     = false
}

variable "mx_hostname" {
  description = "Hostname for MX record (e.g., 'email' creates email.domain.com)"
  type        = string
  default     = "email"
}

variable "mx_priority" {
  description = "Priority for MX record"
  type        = number
  default     = 10
}

variable "ttl" {
  description = "TTL for DNS records in seconds"
  type        = number
  default     = 60
}

variable "mx_ttl" {
  description = "TTL for MX records in seconds"
  type        = number
  default     = 300
}
