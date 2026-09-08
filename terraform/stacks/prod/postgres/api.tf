resource "planetscale_postgres_branch_role" "runtime" {
  organization    = planetscale_postgres_branch.main.organization
  database        = planetscale_postgres_branch.main.database
  branch          = planetscale_postgres_branch.main.name
  name            = "tearleads-runtime"
  inherited_roles = ["pg_read_all_data", "pg_write_all_data"]
  ttl             = 0

  lifecycle {
    prevent_destroy = true
  }
}

# Preserve the elevated login created during the greenfield bootstrap.
moved {
  from = planetscale_postgres_branch_role.api
  to   = planetscale_postgres_branch_role.migrations
}

resource "planetscale_postgres_branch_role" "migrations" {
  organization    = planetscale_postgres_branch.main.organization
  database        = planetscale_postgres_branch.main.database
  branch          = planetscale_postgres_branch.main.name
  name            = "tearleads-migrations"
  inherited_roles = ["postgres"]
  ttl             = 0

  lifecycle {
    prevent_destroy = true
  }
}

# Consumed by Ansible as a mode-0600 extra-vars file on the deployment machine.
# This stays in the database state, never in server state or cloud-init.
output "api_connection" {
  description = "Sensitive Ansible variables for the production API database"
  sensitive   = true
  value = {
    postgres_managed            = true
    postgres_host               = planetscale_postgres_branch_role.runtime.access_host_url
    postgres_port               = "6432" # Included PgBouncer shares the PS-5 server pool.
    postgres_migration_port     = "5432"
    postgres_db                 = planetscale_postgres_branch_role.runtime.database_name
    postgres_user               = planetscale_postgres_branch_role.runtime.username
    postgres_password           = planetscale_postgres_branch_role.runtime.password
    postgres_migration_user     = planetscale_postgres_branch_role.migrations.username
    postgres_migration_password = planetscale_postgres_branch_role.migrations.password
    postgres_ssl                = true
  }
}
