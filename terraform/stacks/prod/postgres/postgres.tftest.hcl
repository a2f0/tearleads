mock_provider "planetscale" {
  mock_resource "planetscale_postgres_branch_role" {
    override_during = plan
    defaults = {
      access_host_url = "fixture.pg.psdb.cloud"
      database_name   = "postgres"
      username        = "api.fixture-branch"
      password        = "fixture-password"
    }
  }
}

override_resource {
  target = planetscale_postgres_branch.main
  values = {
    replicas = 0
  }
  override_during = plan
}

variables {
  planetscale_branch_id    = "existing-main-branch"
  planetscale_cluster_size = "PS_5_AWS_ARM"
}

run "accept_single_node" {
  command = plan

  assert {
    condition     = planetscale_postgres_branch.main.region == "us-east"
    error_message = "The branch must use PlanetScale's AWS us-east-1 region slug."
  }

  assert {
    condition     = planetscale_postgres_branch.main.cluster_size == "PS_5_AWS_ARM"
    error_message = "The branch must preserve the selected PS-5 ARM size."
  }

  assert {
    condition     = planetscale_postgres_branch.main.deletion_protected
    error_message = "The production branch must have deletion protection enabled."
  }
}

run "reject_ha_branch" {
  command = plan

  override_resource {
    target = planetscale_postgres_branch.main
    values = {
      replicas = 2
    }
    override_during = plan
  }

  expect_failures = [planetscale_postgres_branch.main]
}

run "preserve_x86_architecture" {
  command = plan

  variables {
    planetscale_cluster_size = "PS_5_AWS_X86"
  }

  assert {
    condition     = planetscale_postgres_branch.main.cluster_size == "PS_5_AWS_X86"
    error_message = "An imported x86 branch must keep its selected architecture."
  }
}

run "reject_larger_size" {
  command = plan

  variables {
    planetscale_cluster_size = "PS_10_AWS_ARM"
  }

  expect_failures = [var.planetscale_cluster_size]
}

run "reject_missing_branch_id" {
  command = plan

  variables {
    planetscale_branch_id = "  "
  }

  expect_failures = [var.planetscale_branch_id]
}

run "api_connection_uses_persistent_branch" {
  command = plan

  assert {
    condition = (
      planetscale_postgres_branch_role.api.organization == planetscale_postgres_branch.main.organization &&
      planetscale_postgres_branch_role.api.database == planetscale_postgres_branch.main.database &&
      planetscale_postgres_branch_role.api.branch == planetscale_postgres_branch.main.name &&
      planetscale_postgres_branch_role.api.ttl == 0
    )
    error_message = "The API login must target the persistent branch without expiring."
  }

  assert {
    condition = (
      output.api_connection.postgres_managed && output.api_connection.postgres_ssl &&
      output.api_connection.postgres_port == "6432" &&
      output.api_connection.postgres_migration_port == "5432" &&
      output.api_connection.postgres_host == "fixture.pg.psdb.cloud" &&
      output.api_connection.postgres_db == "postgres" &&
      output.api_connection.postgres_user == "api.fixture-branch" &&
      output.api_connection.postgres_password == "fixture-password"
    )
    error_message = "Ansible must receive TLS credentials with pooled runtime and direct migration connections."
  }
}
