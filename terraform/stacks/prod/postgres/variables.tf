variable "planetscale_organization" {
  description = "PlanetScale organization slug"
  type        = string
  default     = "tearleads"
}

variable "planetscale_database" {
  description = "PlanetScale database name"
  type        = string
  default     = "tearleads-prod"
}

variable "planetscale_cluster_size" {
  description = "PS-5 architecture; the main branch must have zero replicas in us-east-1"
  type        = string

  validation {
    condition     = contains(["PS_5_AWS_ARM", "PS_5_AWS_X86"], var.planetscale_cluster_size)
    error_message = "This stack is restricted to the cheapest PS-5 size."
  }
}

variable "planetscale_service_token_id" {
  description = "PlanetScale service token ID for the database API"
  type        = string
  sensitive   = true
  ephemeral   = true
  default     = ""
}

variable "planetscale_service_token" {
  description = "PlanetScale service token for the database API"
  type        = string
  sensitive   = true
  ephemeral   = true
  default     = ""
}
