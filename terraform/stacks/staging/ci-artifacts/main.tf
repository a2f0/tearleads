module "ci_artifacts" {
  source = "../../../modules/aws-ci-artifacts"

  environment  = "staging"
  bucket_name  = "tearleads-staging-ci-artifacts"
  ci_user_name = "tearleads-staging-ci"

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
    "tearleads-staging/website",
  ]
  ecr_lifecycle_max_images = 20

  tags = {
    Project = "tearleads"
    Stack   = "ci-artifacts"
  }
}
