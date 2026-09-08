variable "planetscale_organization" {
  description = "PlanetScale organization slug"
  type        = string
  default     = "tearleads"
}

variable "planetscale_database" {
  description = "PlanetScale database name created during the one-time bootstrap"
  type        = string
  default     = "tearleads-prod"
}

variable "planetscale_branch_id" {
  description = "Existing main branch ID to import, from pscale branch show or the PlanetScale API"
  type        = string

  validation {
    condition     = length(trimspace(var.planetscale_branch_id)) > 0
    error_message = "Create the single-node database first and supply its main branch ID."
  }
}

variable "planetscale_cluster_size" {
  description = "PS-5 architecture selected during bootstrap; both cost $5/month with zero replicas in us-east-1"
  type        = string
  default     = "PS_5_AWS_ARM"

  validation {
    condition     = contains(["PS_5_AWS_ARM", "PS_5_AWS_X86"], var.planetscale_cluster_size)
    error_message = "This stack is restricted to the cheapest PS-5 size."
  }
}
