mock_provider "cloudflare" {}

mock_provider "external" {
  mock_data "external" {
    defaults = { result = { ready = "true" } }
  }
}

mock_provider "restapi" {
  override_during = apply
}

override_resource {
  target          = restapi_object.database
  override_during = apply
  values = {
    id = "tearleads-prod"
  }
}

mock_provider "planetscale" {
  override_during = apply
  mock_resource "planetscale_postgres_branch_role" {
    defaults = {
      access_host_url = "fixture.pg.psdb.cloud"
      database_name   = "postgres"
      username        = "api.fixture-branch"
      password        = "fixture-password"
    }
  }
}

override_resource {
  target          = planetscale_postgres_branch_role.migrations
  override_during = apply
  values = {
    access_host_url = "fixture.pg.psdb.cloud"
    username        = "migration.fixture-branch"
    password        = "fixture-migration-password"
  }
}

override_data {
  target = data.planetscale_postgres_branch.main
  values = {
    replicas           = 0
    cluster_size       = "PS_5_AWS_ARM"
    region             = "us-east"
    name               = "main"
    deletion_protected = true
  }
}

variables {
  cloudflare_account_id    = "fixture-account"
  cloudflare_api_token     = "fixture-token"
  planetscale_cluster_size = "PS_5_AWS_ARM"
}

run "accept_single_node" {
  command   = apply
  state_key = "accept_single_node"

  assert {
    condition = (
      jsondecode(restapi_object.database.data).replicas == 0 &&
      jsondecode(restapi_object.database.data).kind == "postgresql" &&
      jsondecode(restapi_object.main_protection.data).deletion_protected &&
      !jsondecode(restapi_object.main_protection.destroy_data).deletion_protected
    )
    error_message = "Creation must request zero replicas and manage branch protection."
  }

  assert {
    condition     = data.planetscale_postgres_branch.main.region == "us-east"
    error_message = "The branch must use PlanetScale's AWS us-east-1 region slug."
  }

  assert {
    condition     = data.planetscale_postgres_branch.main.cluster_size == "PS_5_AWS_ARM"
    error_message = "The branch must preserve the selected PS-5 ARM size."
  }

  assert {
    condition     = data.planetscale_postgres_branch.main.deletion_protected
    error_message = "The production branch must have deletion protection enabled."
  }
}

run "reject_ha_branch" {
  command   = apply
  state_key = "reject_ha_branch"

  override_data {
    target = data.planetscale_postgres_branch.main
    values = {
      replicas           = 2
      cluster_size       = "PS_5_AWS_ARM"
      region             = "us-east"
      name               = "main"
      deletion_protected = true
    }
  }

  expect_failures = [data.planetscale_postgres_branch.main]
}

run "preserve_x86_architecture" {
  command   = apply
  state_key = "preserve_x86_architecture"

  variables {
    planetscale_cluster_size = "PS_5_AWS_X86"
  }

  override_data {
    target = data.planetscale_postgres_branch.main
    values = {
      replicas           = 0
      cluster_size       = "PS_5_AWS_X86"
      region             = "us-east"
      name               = "main"
      deletion_protected = true
    }
  }

  assert {
    condition     = data.planetscale_postgres_branch.main.cluster_size == "PS_5_AWS_X86"
    error_message = "The branch must use the selected x86 architecture."
  }
}

run "reject_larger_size" {
  command   = plan
  state_key = "reject_larger_size"

  variables {
    planetscale_cluster_size = "PS_10_AWS_ARM"
  }

  expect_failures = [var.planetscale_cluster_size]
}

run "api_connection_uses_persistent_branch" {
  command   = apply
  state_key = "api_connection_uses_persistent_branch"

  assert {
    condition = (
      planetscale_postgres_branch_role.runtime.organization == data.planetscale_postgres_branch.main.organization &&
      planetscale_postgres_branch_role.runtime.database == data.planetscale_postgres_branch.main.database &&
      planetscale_postgres_branch_role.runtime.branch == data.planetscale_postgres_branch.main.name &&
      planetscale_postgres_branch_role.runtime.ttl == 0 &&
      toset(planetscale_postgres_branch_role.runtime.inherited_roles) == toset(["pg_read_all_data", "pg_write_all_data"]) &&
      toset(planetscale_postgres_branch_role.migrations.inherited_roles) == toset(["postgres"])
    )
    error_message = "The API login must target the persistent branch without expiring."
  }

  assert {
    condition = (
      output.api_connection.postgres_migration_port == "5432" &&
      output.api_connection.postgres_host == "fixture.pg.psdb.cloud" &&
      output.api_connection.postgres_db == "postgres" &&
      output.api_connection.postgres_migration_user == "migration.fixture-branch" &&
      output.api_connection.postgres_migration_password == "fixture-migration-password"
    )
    error_message = "The deploy host must receive the direct migration connection."
  }
}

run "reject_mismatched_role_hosts" {
  command   = apply
  state_key = "reject_mismatched_role_hosts"

  override_resource {
    target          = planetscale_postgres_branch_role.migrations
    override_during = apply
    values = {
      access_host_url = "different.pg.psdb.cloud"
    }
  }

  expect_failures = [output.api_connection]
}

run "hyperdrive_runtime_connection" {
  command   = apply
  state_key = "hyperdrive_runtime_connection"

  assert {
    condition = (
      cloudflare_hyperdrive_config.api.account_id == var.cloudflare_account_id &&
      cloudflare_hyperdrive_config.api.origin.host == "fixture.pg.psdb.cloud" &&
      cloudflare_hyperdrive_config.api.origin.port == 6432 &&
      cloudflare_hyperdrive_config.api.origin.database == "postgres" &&
      cloudflare_hyperdrive_config.api.origin.user == "api.fixture-branch" &&
      cloudflare_hyperdrive_config.api.origin.password == "fixture-password" &&
      cloudflare_hyperdrive_config.api.origin.scheme == "postgres" &&
      cloudflare_hyperdrive_config.api.mtls.sslmode == "require" &&
      cloudflare_hyperdrive_config.api.caching.disabled &&
      cloudflare_hyperdrive_config.api.origin_connection_limit == 20 &&
      output.hyperdrive_id == cloudflare_hyperdrive_config.api.id
    )
    error_message = "Hyperdrive must pool the runtime login over TLS without caching API reads."
  }

  assert {
    condition     = !contains(keys(output.api_connection), "postgres_password")
    error_message = "The deploy output must not export the runtime password."
  }
}
