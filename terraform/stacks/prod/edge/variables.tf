variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}
variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}
variable "domain" {
  description = "Cloudflare zone name for the public hostnames"
  type        = string
}
variable "deployment_tier" {
  description = "Deployment tier used in Worker names and public hostnames"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.deployment_tier)
    error_message = "deployment_tier must be prod or staging."
  }
}
