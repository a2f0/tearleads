mock_provider "aws" {
  mock_resource "aws_iam_access_key" {
    defaults = { id = "fixture-access-key", secret = "fixture-secret" }
  }
}

variables {
  bucket        = { id = "fixture-blobs", arn = "arn:aws:s3:::fixture-blobs", region = "us-east-1" }
  iam_user_name = "fixture-api-blobs"
}

run "application_permissions_and_connection" {
  command = apply

  assert {
    condition = (
      aws_s3_bucket_public_access_block.blobs.bucket == var.bucket.id &&
      aws_s3_bucket_public_access_block.blobs.block_public_acls &&
      aws_s3_bucket_public_access_block.blobs.block_public_policy &&
      aws_s3_bucket_public_access_block.blobs.ignore_public_acls &&
      aws_s3_bucket_public_access_block.blobs.restrict_public_buckets &&
      aws_s3_bucket_ownership_controls.blobs.bucket == var.bucket.id &&
      one(aws_s3_bucket_ownership_controls.blobs.rule).object_ownership == "BucketOwnerEnforced" &&
      aws_s3_bucket_server_side_encryption_configuration.blobs.bucket == var.bucket.id &&
      one(one(aws_s3_bucket_server_side_encryption_configuration.blobs.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"
    )
    error_message = "The blob bucket must block all public access, disable ACLs, and encrypt stored objects."
  }

  assert {
    condition = (
      aws_s3_bucket_policy.tls.bucket == var.bucket.id &&
      jsondecode(aws_s3_bucket_policy.tls.policy) == jsondecode(jsonencode({
        Version = "2012-10-17"
        Statement = [{
          Sid       = "RequireTLS"
          Effect    = "Deny"
          Principal = "*"
          Action    = "s3:*"
          Resource  = [var.bucket.arn, "${var.bucket.arn}/*"]
          Condition = { Bool = { "aws:SecureTransport" = "false" } }
        }]
      }))
    )
    error_message = "The bucket policy must deny all non-TLS operations for every principal."
  }

  assert {
    condition = (
      aws_iam_user.api.name == var.iam_user_name &&
      aws_iam_access_key.api.user == aws_iam_user.api.name &&
      aws_iam_user_policy.blobs.user == aws_iam_user.api.name &&
      length(jsondecode(aws_iam_user_policy.blobs.policy).Statement) == 2 &&
      jsondecode(aws_iam_user_policy.blobs.policy).Statement[0].Effect == "Allow" &&
      jsondecode(aws_iam_user_policy.blobs.policy).Statement[1].Effect == "Allow" &&
      jsondecode(aws_iam_user_policy.blobs.policy).Statement[0].Resource == var.bucket.arn &&
      jsondecode(aws_iam_user_policy.blobs.policy).Statement[1].Resource == "${var.bucket.arn}/*" &&
      toset(jsondecode(aws_iam_user_policy.blobs.policy).Statement[0].Action) == toset([
        "s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"
      ]) &&
      toset(jsondecode(aws_iam_user_policy.blobs.policy).Statement[1].Action) == toset([
        "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
        "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"
      ])
    )
    error_message = "Application credentials must have only their bucket's object and multipart permissions."
  }

  assert {
    condition = (
      output.api_storage.blob_storage_managed && !output.api_storage.garage_enabled &&
      output.api_storage.blob_object_store == "s3" &&
      output.api_storage.blob_s3_bucket == var.bucket.id &&
      output.api_storage.blob_s3_region == "us-east-1" &&
      output.api_storage.blob_s3_endpoint == "" &&
      !output.api_storage.blob_s3_force_path_style &&
      output.api_storage.blob_s3_access_key_id == "fixture-access-key" &&
      output.api_storage.blob_s3_secret_access_key == "fixture-secret" &&
      output.api_storage.blob_s3_key_prefix == ""
    )
    error_message = "Ansible must select AWS S3 using this bucket's application key."
  }
}
