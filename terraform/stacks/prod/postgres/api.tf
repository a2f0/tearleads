# The API and maintenance executables run Drizzle migrations on startup, so
# their dedicated login needs DDL privileges as well as read/write access.
resource "planetscale_postgres_branch_role" "api" {
  organization    = planetscale_postgres_branch.main.organization
  database        = planetscale_postgres_branch.main.database
  branch          = planetscale_postgres_branch.main.name
  name            = "tearleads-api"
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
    postgres_managed        = true
    postgres_host           = planetscale_postgres_branch_role.api.access_host_url
    postgres_port           = "6432" # Included PgBouncer shares the PS-5 server pool.
    postgres_migration_port = "5432"
    postgres_db             = planetscale_postgres_branch_role.api.database_name
    postgres_user           = planetscale_postgres_branch_role.api.username
    postgres_password       = planetscale_postgres_branch_role.api.password
    postgres_ssl            = true
  }
}
