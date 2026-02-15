variable "postgres_password" {
  description = "PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to RDS (required - no insecure default)"
  type        = list(string)

  validation {
    condition     = length(var.allowed_cidr_blocks) > 0
    error_message = "allowed_cidr_blocks must be explicitly set to k8s cluster IP(s)"
  }
}
