variable "monthly_budget_limit" {
  description = "Monthly budget limit in USD"
  type        = string
  default     = "100"
}

variable "rds_budget_limit" {
  description = "Monthly RDS budget limit in USD"
  type        = string
  default     = "50"
}

variable "s3_budget_limit" {
  description = "Monthly S3 budget limit in USD"
  type        = string
  default     = "20"
}

variable "ecr_budget_limit" {
  description = "Monthly ECR budget limit in USD"
  type        = string
  default     = "10"
}
