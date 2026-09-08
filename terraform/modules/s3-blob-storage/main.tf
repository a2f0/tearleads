resource "aws_s3_bucket_public_access_block" "blobs" {
  bucket                  = var.bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "blobs" {
  bucket = var.bucket.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "blobs" {
  bucket = var.bucket.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "tls" {
  bucket = var.bucket.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RequireTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [var.bucket.arn, "${var.bucket.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_iam_user" "api" {
  name = var.iam_user_name
}

resource "aws_iam_user_policy" "blobs" {
  name = "blob-storage"
  user = aws_iam_user.api.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BucketMetadata"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"]
        Resource = var.bucket.arn
      },
      {
        Sid    = "BlobObjects"
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
          "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
        ]
        Resource = "${var.bucket.arn}/*"
      }
    ]
  })
}

resource "aws_iam_access_key" "api" {
  user       = aws_iam_user.api.name
  depends_on = [aws_iam_user_policy.blobs]
}
