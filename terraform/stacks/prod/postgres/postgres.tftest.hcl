mock_provider "planetscale" {}

override_resource {
  target = planetscale_postgres_branch.main
  values = {
    organization       = "tearleads"
    database           = "tearleads-prod"
    name               = "main"
    region             = "us-east"
    cluster_size       = "PS_5_AWS_ARM"
    deletion_protected = true
    replicas           = 0
  }
  override_during = plan
}

variables {
  planetscale_branch_id = "existing-main-branch"
}

run "accept_single_node" {
  command = plan
}

run "reject_ha_branch" {
  command = plan

  override_resource {
    target = planetscale_postgres_branch.main
    values = {
      organization       = "tearleads"
      database           = "tearleads-prod"
      name               = "main"
      region             = "us-east"
      cluster_size       = "PS_5_AWS_ARM"
      deletion_protected = true
      replicas           = 2
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
