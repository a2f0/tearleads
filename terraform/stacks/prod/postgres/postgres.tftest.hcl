mock_provider "planetscale" {}

override_resource {
  target = planetscale_postgres_branch.main
  values = {
    replicas = 0
  }
  override_during = plan
}

variables {
  planetscale_branch_id = "existing-main-branch"
}

run "accept_single_node" {
  command = plan

  assert {
    condition     = planetscale_postgres_branch.main.region == "us-east"
    error_message = "The branch must use PlanetScale's AWS us-east-1 region slug."
  }

  assert {
    condition     = planetscale_postgres_branch.main.cluster_size == "PS_5_AWS_ARM"
    error_message = "The branch must use the cheapest PS-5 ARM size by default."
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

run "reject_larger_size" {
  command = plan

  variables {
    planetscale_cluster_size = "PS_10_AWS_ARM"
  }

  expect_failures = [var.planetscale_cluster_size]
}
