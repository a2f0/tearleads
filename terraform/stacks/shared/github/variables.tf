variable "github_owner" {
  description = "GitHub owner (user or organization)"
  type        = string
  default     = "a2f0"
}

variable "repository_name" {
  description = "GitHub repository name"
  type        = string
  default     = "tearleads"
}

variable "enable_merge_signing_app_installation" {
  description = "Whether to manage GitHub App installation on this repository for merge-signing automation"
  type        = bool
  default     = false
}

variable "merge_signing_app_installation_id" {
  description = "GitHub App installation ID to attach to this repository when enable_merge_signing_app_installation is true"
  type        = number
  default     = null
  nullable    = true
}

variable "merge_signing_app_slug" {
  description = "Optional GitHub App slug for metadata lookup and outputs"
  type        = string
  default     = null
  nullable    = true
}

variable "use_repository_ruleset_for_main" {
  description = "Whether to manage main branch protections via github_repository_ruleset instead of github_branch_protection"
  type        = bool
  default     = true
}

variable "enable_merge_signing_bypass" {
  description = "Whether to grant merge-signing app bypass access in the main branch repository ruleset"
  type        = bool
  default     = true
}

variable "merge_signing_app_id" {
  description = "GitHub App ID used as Integration actor_id for repository ruleset bypass"
  type        = number
  default     = 2889195
}

variable "tearleads_version_bumper_app_id" {
  description = "Deprecated alias for merge_signing_app_id"
  type        = number
  default     = null
  nullable    = true
}

variable "tearleads_version_bumper_installation_id" {
  description = "Deprecated alias for merge_signing_app_installation_id"
  type        = number
  default     = null
  nullable    = true
}

variable "tearleads_version_bumper_installatio_id" {
  description = "Deprecated typo alias for merge_signing_app_installation_id (kept for compatibility)"
  type        = number
  default     = null
  nullable    = true
}

variable "tearleads_version_bumper_app_slug" {
  description = "Deprecated alias for merge_signing_app_slug"
  type        = string
  default     = null
  nullable    = true
}
