output "database" {
  description = "Managed PlanetScale database and branch (credentials are in the sensitive api_connection output)"
  value = {
    organization = data.planetscale_postgres_branch.main.organization
    name         = data.planetscale_postgres_branch.main.database
    branch       = data.planetscale_postgres_branch.main.name
    branch_id    = data.planetscale_postgres_branch.main.id
    region       = data.planetscale_postgres_branch.main.region
    cluster_size = data.planetscale_postgres_branch.main.cluster_size
    replicas     = data.planetscale_postgres_branch.main.replicas
    dashboard    = data.planetscale_postgres_branch.main.html_url
  }
}
