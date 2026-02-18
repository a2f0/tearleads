data "aws_caller_identity" "current" {}

locals {
  github_actions_oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
}

module "ci_artifacts" {
  source = "../../../modules/aws-ci-artifacts"

  environment  = "prod"
  bucket_name  = "tearleads-prod-ci-artifacts"
  ci_user_name = "tearleads-prod-ci"
  # Keep legacy user creds for now; CI can migrate to OIDC role.
  enable_ci_user = true

  enable_public_access      = true
  lifecycle_expiration_days = 0 # Keep prod artifacts indefinitely

  cors_allowed_origins = [
    "https://${var.production_domain}",
    "https://app.${var.production_domain}",
    "https://download.${var.production_domain}"
  ]

  # Container registries
  ecr_repositories = [
    "tearleads-prod/api",
    "tearleads-prod/client",
    "tearleads-prod/website",
  ]
  ecr_lifecycle_max_images = 50 # Keep more images in prod

  create_github_actions_role       = true
  github_actions_repository        = var.github_actions_repository
  github_actions_role_name         = "tearleads-prod-github-actions-ecr-push"
  github_actions_branches          = ["main"]
  github_actions_oidc_provider_arn = local.github_actions_oidc_provider_arn

  tags = {
    Project = "tearleads"
    Stack   = "ci-artifacts"
  }
}
