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
    "https://www.googleapis.com/auth/apps.groups.settings",
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

variable "googleworkspace_group_settings_overrides" {
  description = "Optional per-group settings overrides keyed by group email"
  type = map(object({
    allow_external_members         = optional(bool)
    allow_web_posting              = optional(bool)
    include_in_global_address_list = optional(bool)
    who_can_join                   = optional(string)
    who_can_discover_group         = optional(string)
    who_can_view_group             = optional(string)
    who_can_view_membership        = optional(string)
    who_can_post_message           = optional(string)
    who_can_contact_owner          = optional(string)
    who_can_leave_group            = optional(string)
  }))
  default = {}
}

variable "googleworkspace_domain" {
  description = "Primary Google Workspace domain (e.g., example.com)"
  type        = string
}

variable "alerts_group_enabled" {
  description = "Whether to create the alerts@domain distribution group"
  type        = bool
  default     = true
}

variable "support_group_enabled" {
  description = "Whether to create the support@domain distribution group"
  type        = bool
  default     = true
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
