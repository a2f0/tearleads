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

# Branch protection for main
resource "github_branch_protection" "main" {
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
