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
      length(jsondecode(aws_iam_user_policy.blobs.policy).Statement) == 2 &&
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
