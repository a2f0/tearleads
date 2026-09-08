output "database" {
  description = "Managed PlanetScale database and branch (application credentials are created separately)"
  value = {
    organization = planetscale_postgres_branch.main.organization
    name         = planetscale_postgres_branch.main.database
    branch       = planetscale_postgres_branch.main.name
    branch_id    = planetscale_postgres_branch.main.id
    region       = planetscale_postgres_branch.main.region
    cluster_size = planetscale_postgres_branch.main.cluster_size
    replicas     = planetscale_postgres_branch.main.replicas
    dashboard    = planetscale_postgres_branch.main.html_url
  }
}
