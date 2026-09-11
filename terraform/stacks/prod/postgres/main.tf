locals {
  databases_path   = "/organizations/${var.planetscale_organization}/databases"
  main_branch_path = "${local.databases_path}/${restapi_object.database.id}/branches/main"
}

# The database endpoint accepts replicas=0; the native branch resource does not.
resource "restapi_object" "database" {
  path                    = local.databases_path
  update_method           = "PATCH"
  id_attribute            = "name"
  ignore_server_additions = true
  # Database reads return region metadata, while size and replicas belong to the
  # branch. The branch data source below verifies those values on every plan.
  ignore_changes_to = ["region", "cluster_size", "replicas"]
  force_new         = ["name", "kind", "region", "cluster_size", "replicas"]
  data = jsonencode({
    name         = var.planetscale_database
    kind         = "postgresql"
    region       = "us-east"
    cluster_size = var.planetscale_cluster_size
    replicas     = 0
  })

  lifecycle {
    prevent_destroy = true
  }
}

# This resource manages the main branch's protection setting. Destroying it
# releases protection before the database resource deletes the database.
resource "restapi_object" "main_protection" {
  path                    = local.main_branch_path
  object_id               = "main"
  create_path             = local.main_branch_path
  read_path               = local.main_branch_path
  update_path             = local.main_branch_path
  destroy_path            = local.main_branch_path
  create_method           = "PATCH"
  update_method           = "PATCH"
  destroy_method          = "PATCH"
  ignore_server_additions = true
  data                    = jsonencode({ deletion_protected = true })
  destroy_data            = jsonencode({ deletion_protected = false })

  lifecycle {
    prevent_destroy = true
  }
}

data "external" "database_ready" {
  program = ["python3", "${path.module}/../../../scripts/waitForPlanetScaleDatabase.py"]
  query = {
    organization = var.planetscale_organization
    database     = restapi_object.database.id
  }
  depends_on = [restapi_object.main_protection]
}

data "planetscale_postgres_branch" "main" {
  organization = var.planetscale_organization
  database     = restapi_object.database.id
  id           = "main"
  depends_on   = [data.external.database_ready]

  lifecycle {
    postcondition {
      condition     = self.replicas == 0 && self.cluster_size == var.planetscale_cluster_size && self.region == "us-east" && self.deletion_protected
      error_message = "The database must use the selected PS-5 size in us-east with zero replicas and deletion protection."
    }
  }
}
