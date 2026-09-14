mock_provider "aws" {}

variables {
  bucket = {
    id     = "downloads.tearleads.com"
    arn    = "arn:aws:s3:::downloads.tearleads.com"
    region = "us-east-1"
  }
}

run "public_downloads" {
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.downloads.bucket == var.bucket.id &&
      !aws_s3_bucket_public_access_block.downloads.block_public_policy &&
      !aws_s3_bucket_public_access_block.downloads.restrict_public_buckets &&
      aws_s3_bucket_public_access_block.downloads.block_public_acls &&
      aws_s3_bucket_public_access_block.downloads.ignore_public_acls &&
      aws_s3_bucket_ownership_controls.downloads.bucket == var.bucket.id &&
      one(aws_s3_bucket_ownership_controls.downloads.rule).object_ownership == "BucketOwnerEnforced"
    )
    error_message = "Downloads must allow public bucket policies while disabling ACL-based grants."
  }

  assert {
    condition = (
      aws_s3_bucket_policy.downloads.bucket == var.bucket.id &&
      [for statement in jsondecode(aws_s3_bucket_policy.downloads.policy).Statement : statement
        if statement.Effect == "Allow"
        ] == [{
          Sid       = "PublicDownloads"
          Effect    = "Allow"
          Principal = "*"
          Action    = "s3:GetObject"
          Resource  = "arn:aws:s3:::downloads.tearleads.com/*"
      }]
    )
    error_message = "Anonymous access must cover all release objects without granting writes, deletion, or listing."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_s3_bucket_policy.downloads.policy).Statement :
      statement.Effect == "Deny" && statement.Principal == "*" &&
      statement.Action == "s3:*" &&
      try(toset(statement.Resource) == toset([var.bucket.arn, "${var.bucket.arn}/*"]), false) &&
      try(statement.Condition.Bool["aws:SecureTransport"] == "false", false)
    ])
    error_message = "Both authenticated and anonymous S3 requests must require HTTPS."
  }

  assert {
    condition = (
      aws_s3_bucket_server_side_encryption_configuration.downloads.bucket == var.bucket.id &&
      one(one(aws_s3_bucket_server_side_encryption_configuration.downloads.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    )
    error_message = "Downloads must use SSE-S3 encryption, which supports anonymous reads."
  }

  assert {
    condition = (
      aws_s3_bucket_lifecycle_configuration.downloads.bucket == var.bucket.id &&
      length(aws_s3_bucket_lifecycle_configuration.downloads.rule) == 1 &&
      one(aws_s3_bucket_lifecycle_configuration.downloads.rule).status == "Enabled" &&
      one(one(aws_s3_bucket_lifecycle_configuration.downloads.rule).filter).prefix == "" &&
      one(one(aws_s3_bucket_lifecycle_configuration.downloads.rule).abort_incomplete_multipart_upload).days_after_initiation == 7 &&
      length(one(aws_s3_bucket_lifecycle_configuration.downloads.rule).expiration) == 0 &&
      length(one(aws_s3_bucket_lifecycle_configuration.downloads.rule).noncurrent_version_expiration) == 0
    )
    error_message = "Abandoned multipart uploads must be cleaned up without expiring release artifacts."
  }

  assert {
    condition     = output.download_base_url == "https://s3.us-east-1.amazonaws.com/downloads.tearleads.com"
    error_message = "Dotted bucket names need a regional path-style URL for valid HTTPS downloads."
  }
}
