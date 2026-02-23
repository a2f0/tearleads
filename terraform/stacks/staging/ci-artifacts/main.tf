data "terraform_remote_state" "shared_github" {
  backend = "s3"

  config = {
    bucket = "tearleads-terraform-state"
    key    = "shared/github/terraform.tfstate"
    region = "us-east-1"
  }
}

module "ci_artifacts" {
  source = "../../../modules/aws-ci-artifacts"

  environment  = "staging"
  bucket_name  = "tearleads-staging-ci-artifacts"
  ci_user_name = "tearleads-staging-ci"
  # Keep legacy user creds for now; CI can migrate to OIDC role.
  enable_ci_user = true

  enable_public_access      = true
  lifecycle_expiration_days = 30

  cors_allowed_origins = [
    "https://${var.staging_domain}",
    "https://app.${var.staging_domain}",
    "https://download.${var.staging_domain}"
  ]

  # Container registries
  ecr_repositories = [
    "tearleads-staging/api",
    "tearleads-staging/client",
    "tearleads-staging/smtp-listener",
    "tearleads-staging/website",
  ]
  ecr_lifecycle_max_images = 20

  create_github_actions_role       = true
  github_actions_repository        = var.github_actions_repository
  github_actions_role_name         = "tearleads-staging-github-actions-ecr-push"
  github_actions_branches          = ["main"]
  github_actions_oidc_provider_arn = data.terraform_remote_state.shared_github.outputs.github_actions_oidc_provider_arn

  tags = {
    Project = "tearleads"
    Stack   = "ci-artifacts"
  }
}
