resource "aws_s3_bucket" "vfs_blobs" {
  bucket        = "tearleads-prod-vfs-blobs"
  force_destroy = true

  tags = {
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "s3"
  }
}

resource "aws_s3_bucket_versioning" "vfs_blobs" {
  bucket = aws_s3_bucket.vfs_blobs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "vfs_blobs" {
  bucket = aws_s3_bucket.vfs_blobs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "vfs_blobs" {
  bucket = aws_s3_bucket.vfs_blobs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_user" "vfs_blobs" {
  name = "tearleads-prod-vfs-blobs"

  tags = {
    Project     = "tearleads"
    Environment = "prod"
    Stack       = "s3"
  }
}

resource "aws_iam_user_policy" "vfs_blobs" {
  name = "tearleads-prod-vfs-blobs"
  user = aws_iam_user.vfs_blobs.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.vfs_blobs.arn}/*"
      },
    ]
  })
}

resource "aws_iam_access_key" "vfs_blobs" {
  user = aws_iam_user.vfs_blobs.name
}
