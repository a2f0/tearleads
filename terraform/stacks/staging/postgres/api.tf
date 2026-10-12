resource "planetscale_postgres_branch_role" "runtime" {
  organization    = data.planetscale_postgres_branch.main.organization
  database        = data.planetscale_postgres_branch.main.database
  branch          = data.planetscale_postgres_branch.main.name
  name            = "tearleads-runtime"
  inherited_roles = ["pg_read_all_data", "pg_write_all_data"]
  ttl             = 0
}

resource "planetscale_postgres_branch_role" "migrations" {
  organization    = data.planetscale_postgres_branch.main.organization
  database        = data.planetscale_postgres_branch.main.database
  branch          = data.planetscale_postgres_branch.main.name
  name            = "tearleads-migrations"
  inherited_roles = ["postgres"]
  ttl             = 0
}

# Consumed by packages/api/scripts/deployApi.sh, which runs migrations with
# the migration login and syncs the runtime login as Worker secrets. This stays
# in the database state and never in the edge stack.
output "api_connection" {
  description = "Sensitive Ansible variables for the production API database"
  sensitive   = true
  precondition {
    condition     = planetscale_postgres_branch_role.runtime.access_host_url == planetscale_postgres_branch_role.migrations.access_host_url
    error_message = "The runtime and migration roles must share the branch connection host."
  }
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
