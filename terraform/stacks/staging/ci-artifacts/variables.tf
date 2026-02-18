variable "staging_domain" {
  description = "Staging domain name"
  type        = string
}

variable "github_actions_repository" {
  description = "GitHub repository allowed to assume CI OIDC role (owner/repo)"
  type        = string
  default     = "a2f0/tearleads"
}
