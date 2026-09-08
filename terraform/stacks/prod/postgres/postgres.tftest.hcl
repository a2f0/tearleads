mock_provider "planetscale" {}

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
