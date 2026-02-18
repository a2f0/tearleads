variable "environment" {
  description = "Environment name (staging, prod)"
  type        = string
}

variable "bucket_name" {
  description = "S3 bucket name for CI artifacts"
  type        = string
}

variable "enable_versioning" {
  description = "Enable S3 bucket versioning"
  type        = bool
  default     = true
}

variable "enable_public_access" {
  description = "Enable public read access for downloads"
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "CORS allowed origins for browser downloads"
  type        = list(string)
  default     = ["*"]
}

variable "lifecycle_expiration_days" {
  description = "Days after which old artifacts are deleted (0 to disable)"
  type        = number
  default     = 90
}

variable "ci_user_name" {
  description = "IAM user name for CI access"
  type        = string
}

variable "enable_ci_user" {
  description = "Create legacy IAM user + access key for CI"
  type        = bool
  default     = true
}

variable "create_github_actions_role" {
  description = "Create a GitHub Actions OIDC role for CI"
  type        = bool
  default     = false
}

variable "github_actions_repository" {
  description = "GitHub repository in owner/repo format allowed to assume the role"
  type        = string
  default     = null
}

variable "github_actions_branches" {
  description = "Branches allowed to assume the GitHub Actions role"
  type        = list(string)
  default     = ["main"]
}

variable "github_actions_oidc_provider_arn" {
  description = "Existing GitHub OIDC provider ARN. If null, module creates one."
  type        = string
  default     = null
}

variable "github_actions_role_name" {
  description = "Optional custom role name for GitHub Actions OIDC role"
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}

variable "ecr_repositories" {
  description = "List of ECR repository names to create"
  type        = list(string)
  default     = []
}

variable "ecr_image_tag_mutability" {
  description = "Image tag mutability setting (MUTABLE or IMMUTABLE)"
  type        = string
  default     = "MUTABLE"
}

variable "ecr_scan_on_push" {
  description = "Enable image scanning on push"
  type        = bool
  default     = true
}

variable "ecr_lifecycle_max_images" {
  description = "Maximum number of images to keep per repository (0 to disable)"
  type        = number
  default     = 30
}
