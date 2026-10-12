# Credentials stay in the database state; the Worker receives only a binding.
resource "cloudflare_hyperdrive_config" "api" {
  account_id = var.cloudflare_account_id
  name       = "tearleads-api-prod"
  origin = {
    scheme   = "postgres"
    host     = planetscale_postgres_branch_role.runtime.access_host_url
    port     = 6432
    database = planetscale_postgres_branch_role.runtime.database_name
    user     = planetscale_postgres_branch_role.runtime.username
    password = planetscale_postgres_branch_role.runtime.password
  }
  # Hyperdrive's require mode enforces TLS and validates WebPKI certificates.
  mtls = { sslmode = "require" }
  # Sync cursors, access epochs, and session revocation must see fresh reads.
  caching                 = { disabled = true }
  origin_connection_limit = 20
}

output "hyperdrive_id" {
  description = "Hyperdrive configuration bound to the API Worker at deploy time"
  value       = cloudflare_hyperdrive_config.api.id
}
