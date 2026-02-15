module "ci_artifacts" {
  source = "../../../modules/aws-ci-artifacts"

  environment  = "prod"
  bucket_name  = "tearleads-prod-ci-artifacts"
  ci_user_name = "tearleads-prod-ci"

  enable_public_access      = true
  lifecycle_expiration_days = 0 # Keep prod artifacts indefinitely

  cors_allowed_origins = [
    "https://${var.production_domain}",
    "https://app.${var.production_domain}",
    "https://download.${var.production_domain}"
  ]

  tags = {
    Project = "tearleads"
    Stack   = "ci-artifacts"
  }
}
