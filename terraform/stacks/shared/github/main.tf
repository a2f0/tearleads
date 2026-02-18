# Repository configuration
resource "github_repository" "main" {
  name        = var.repository_name
  description = ""
  visibility  = "public"

  has_issues   = true
  has_projects = true
  has_wiki     = true

  allow_merge_commit  = true
  allow_squash_merge  = false
  allow_rebase_merge  = false
  allow_auto_merge    = true
  allow_update_branch = true

  delete_branch_on_merge = true

  archive_on_destroy = true

  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }
}

moved {
  from = github_branch_protection.main
  to   = github_branch_protection.main[0]
}

locals {
  effective_merge_signing_app_id = try(coalesce(
    var.merge_signing_app_id,
    var.tearleads_version_bumper_app_id
  ), null)

  effective_merge_signing_app_installation_id = try(coalesce(
    var.merge_signing_app_installation_id,
    var.tearleads_version_bumper_installation_id,
    var.tearleads_version_bumper_installatio_id
  ), null)

  effective_merge_signing_app_slug = try(coalesce(
    var.merge_signing_app_slug,
    var.tearleads_version_bumper_app_slug
  ), null)
}

# Branch protection for main
resource "github_branch_protection" "main" {
  count = var.use_repository_ruleset_for_main ? 0 : 1

  repository_id = github_repository.main.node_id
  pattern       = "main"

  # Require status checks to pass
  required_status_checks {
    strict = false
    contexts = [
      "build",
      "Android Instrumented Tests",
      "Android Maestro Tests (Release)",
      "iOS Maestro Tests (Release)",
      "Web E2E Tests (Release)",
      "Electron E2E Tests (Release)",
      "Website E2E Tests (Release)",
    ]
  }

  # Require pull request reviews
  required_pull_request_reviews {
    dismiss_stale_reviews           = false
    require_code_owner_reviews      = false
    required_approving_review_count = 0
    require_last_push_approval      = false
  }

  # Require signed commits
  require_signed_commits = true

  # Enforce for admins
  enforce_admins = true

  # Require conversation resolution
  require_conversation_resolution = true

  # Disallow force pushes
  allows_force_pushes = false

  # Disallow deletions
  allows_deletions = false
}

resource "github_repository_ruleset" "main" {
  count = var.use_repository_ruleset_for_main ? 1 : 0

  name        = "main-branch-protection"
  repository  = github_repository.main.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/heads/main"]
      exclude = []
    }
  }

  dynamic "bypass_actors" {
    for_each = var.enable_merge_signing_bypass ? [1] : []

    content {
      actor_id    = local.effective_merge_signing_app_id
      actor_type  = "Integration"
      bypass_mode = "always"
    }
  }

  rules {
    required_signatures = true
    non_fast_forward    = true
    deletion            = true

    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = true
      allowed_merge_methods             = ["merge"]
    }

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check {
        context = "build"
      }
      required_check {
        context = "Android Instrumented Tests"
      }
      required_check {
        context = "Android Maestro Tests (Release)"
      }
      required_check {
        context = "iOS Maestro Tests (Release)"
      }
      required_check {
        context = "Web E2E Tests (Release)"
      }
      required_check {
        context = "Electron E2E Tests (Release)"
      }
      required_check {
        context = "Website E2E Tests (Release)"
      }
    }
  }
}

check "merge_signing_app_installation_inputs" {
  assert {
    condition = (
      !var.enable_merge_signing_app_installation ||
      local.effective_merge_signing_app_installation_id != null
    )
    error_message = "merge_signing_app_installation_id must be set when enable_merge_signing_app_installation is true."
  }
}

check "merge_signing_bypass_inputs" {
  assert {
    condition = (
      !var.enable_merge_signing_bypass ||
      (
        var.use_repository_ruleset_for_main &&
        local.effective_merge_signing_app_id != null
      )
    )
    error_message = "enable_merge_signing_bypass requires use_repository_ruleset_for_main=true and merge_signing_app_id to be set."
  }
}

data "github_app" "merge_signing" {
  count = local.effective_merge_signing_app_slug != null ? 1 : 0
  slug  = local.effective_merge_signing_app_slug
}

resource "github_app_installation_repository" "merge_signing" {
  count = var.enable_merge_signing_app_installation ? 1 : 0

  installation_id = local.effective_merge_signing_app_installation_id
  repository      = github_repository.main.name
}

# Shared account-global GitHub Actions OIDC provider.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
  client_id_list = [
    "sts.amazonaws.com"
  ]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1"
  ]

  tags = {
    Environment = "shared"
    Project     = "tearleads"
    Purpose     = "github-actions-oidc"
    Stack       = "github"
  }
}
