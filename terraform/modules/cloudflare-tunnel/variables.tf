variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "zone_name" {
  description = "Cloudflare zone name (e.g., tearleads.com)"
  type        = string
}

variable "tunnel_name" {
  description = "Name for the Cloudflare tunnel"
  type        = string
}

variable "ingress_rules" {
  description = "Ingress rules for the tunnel"
  type = list(object({
    hostname = string
    service  = string
    path     = optional(string, "")
  }))
}

variable "catch_all_service" {
  description = "Service for catch-all rule (typically http_status:404)"
  type        = string
  default     = "http_status:404"
}

variable "create_dns_records" {
  description = "Whether to create DNS CNAME records for hostnames"
  type        = bool
  default     = true
}
