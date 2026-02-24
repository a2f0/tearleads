# S3 bucket for CI artifacts
resource "aws_s3_bucket" "artifacts" {
  bucket        = var.bucket_name
  force_destroy = true

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "ci-artifacts"
  })
}

# Bucket versioning
resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Disabled"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Public access block - conditionally allow public access
resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = !var.enable_public_access
  block_public_policy     = !var.enable_public_access
  ignore_public_acls      = !var.enable_public_access
  restrict_public_buckets = !var.enable_public_access
}

# Bucket policy for public read access (if enabled)
resource "aws_s3_bucket_policy" "public_read" {
  count  = var.enable_public_access ? 1 : 0
  bucket = aws_s3_bucket.artifacts.id

  depends_on = [aws_s3_bucket_public_access_block.artifacts]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/*"
      }
    ]
  })
}

# CORS configuration for browser downloads
resource "aws_s3_bucket_cors_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag", "Content-Length", "Content-Type"]
    max_age_seconds = 3600
  }
}

# Lifecycle rule to clean up old artifacts
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  count  = var.lifecycle_expiration_days > 0 ? 1 : 0
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-old-artifacts"
    status = "Enabled"
    filter {}

    expiration {
      days = var.lifecycle_expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# IAM user for CI
resource "aws_iam_user" "ci" {
  count = var.enable_ci_user ? 1 : 0
  name  = var.ci_user_name

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "ci-artifacts-upload"
  })
}

# IAM policy for bucket access
resource "aws_iam_user_policy" "ci_artifacts" {
  count = var.enable_ci_user ? 1 : 0
  name  = "${var.ci_user_name}-artifacts-policy"
  user  = aws_iam_user.ci[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = aws_s3_bucket.artifacts.arn
      },
      {
        Sid    = "ObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion"
        ]
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      }
    ]
  })
}

# IAM access key for CI
resource "aws_iam_access_key" "ci" {
  count = var.enable_ci_user ? 1 : 0
  user  = aws_iam_user.ci[0].name
}

# COMPLIANCE_SENTINEL: TL-CR-001 | control=container-registry
# COMPLIANCE_SENTINEL: TL-CR-002 | control=container-image-scanning
# ECR repositories
resource "aws_ecr_repository" "repos" {
  for_each = toset(var.ecr_repositories)

  name                 = each.value
  image_tag_mutability = var.ecr_image_tag_mutability
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = var.ecr_scan_on_push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "container-registry"
  })
}

# COMPLIANCE_SENTINEL: TL-CR-004 | control=container-lifecycle
# ECR lifecycle policy to limit stored images
resource "aws_ecr_lifecycle_policy" "repos" {
  for_each   = var.ecr_lifecycle_max_images > 0 ? toset(var.ecr_repositories) : toset([])
  repository = aws_ecr_repository.repos[each.key].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only last ${var.ecr_lifecycle_max_images} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.ecr_lifecycle_max_images
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# IAM policy for ECR access
resource "aws_iam_user_policy" "ci_ecr" {
  count = var.enable_ci_user && length(var.ecr_repositories) > 0 ? 1 : 0
  name  = "${var.ci_user_name}-ecr-policy"
  user  = aws_iam_user.ci[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRGetAuthToken"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRRepositoryAccess"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:ListImages",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = [for repo in var.ecr_repositories : aws_ecr_repository.repos[repo].arn]
      }
    ]
  })
}

locals {
  github_actions_role_name = var.github_actions_role_name != null ? var.github_actions_role_name : "${var.environment}-github-actions-ecr-push"
  github_actions_subs = [
    for branch in var.github_actions_branches : "repo:${var.github_actions_repository}:ref:refs/heads/${branch}"
  ]
}

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  count = var.create_github_actions_role && var.github_actions_oidc_provider_arn == null ? 1 : 0

  url = "https://token.actions.githubusercontent.com"
  client_id_list = [
    "sts.amazonaws.com"
  ]
  thumbprint_list = data.tls_certificate.github_actions.certificates[*].sha1_fingerprint

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "github-actions-oidc"
  })
}

resource "aws_iam_role" "github_actions" {
  count = var.create_github_actions_role ? 1 : 0
  name  = local.github_actions_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = var.github_actions_oidc_provider_arn != null ? var.github_actions_oidc_provider_arn : aws_iam_openid_connect_provider.github_actions[0].arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = local.github_actions_subs
          }
        }
      }
    ]
  })

  lifecycle {
    precondition {
      condition     = var.github_actions_repository != null
      error_message = "github_actions_repository must be set when create_github_actions_role is enabled."
    }
  }

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "github-actions-ci"
  })
}

resource "aws_iam_role_policy" "github_actions_ecr" {
  count = var.create_github_actions_role && length(var.ecr_repositories) > 0 ? 1 : 0
  name  = "${local.github_actions_role_name}-ecr-policy"
  role  = aws_iam_role.github_actions[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRGetAuthToken"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRRepositoryAccess"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:ListImages",
          "ecr:PutImage",
          "ecr:UploadLayerPart"
        ]
        Resource = [for repo in var.ecr_repositories : aws_ecr_repository.repos[repo].arn]
      }
    ]
  })
}
