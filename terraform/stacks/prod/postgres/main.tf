# Provider 1.9 exposes replicas as read-only. Bootstrap with replicas=0 using
# the dashboard or CLI, then import instead of relying on creation defaults.
import {
  to = planetscale_postgres_branch.main
  id = jsonencode({
    organization = var.planetscale_organization
    database     = var.planetscale_database
    id           = var.planetscale_branch_id
  })
}

resource "planetscale_postgres_branch" "main" {
  organization       = var.planetscale_organization
  database           = var.planetscale_database
  name               = "main"
  region             = "us-east" # PlanetScale's slug for AWS us-east-1 (N. Virginia).
  cluster_size       = var.planetscale_cluster_size
  deletion_protected = true

  lifecycle {
    prevent_destroy = true

    postcondition {
      condition     = self.replicas == 0
      error_message = "The PS-5 $5/month configuration requires zero replicas. Select Single Node in PlanetScale before importing; Terraform cannot change replicas."
    }
  }
}
