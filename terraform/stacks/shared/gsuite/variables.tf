variable "googleworkspace_customer_id" {
  description = "Google Workspace customer ID (for example: C0123abc4)"
  type        = string
}

variable "googleworkspace_access_token" {
  description = "OAuth access token used by the Google Workspace provider"
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "googleworkspace_impersonated_user_email" {
  description = "Admin user email to impersonate (requires googleworkspace_service_account)"
  type        = string
  default     = null
  nullable    = true
}

variable "googleworkspace_service_account" {
  description = "Service account email used to impersonate an admin user"
  type        = string
  default     = null
  nullable    = true
}

variable "googleworkspace_credentials" {
  description = "Optional service account credentials JSON"
  type        = string
  default     = null
  nullable    = true
  sensitive   = true
}

variable "googleworkspace_oauth_scopes" {
  description = "OAuth scopes required by the provider"
  type        = list(string)
  default = [
    "https://www.googleapis.com/auth/admin.directory.group",
  ]
}

variable "googleworkspace_groups" {
  description = "Groups to manage. Map key is the group email address."
  type = map(object({
    name        = string
    description = optional(string)
    aliases     = optional(set(string), [])
  }))
  default = {}
}

check "impersonation_requires_service_account" {
  assert {
    condition = (
      var.googleworkspace_impersonated_user_email == null ||
      var.googleworkspace_service_account != null
    )
    error_message = "googleworkspace_service_account must be set when googleworkspace_impersonated_user_email is provided."
  }
}
