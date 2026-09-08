resource "aws_s3_bucket" "blobs" {
  bucket        = "tearleads-prod"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

module "storage" {
  source        = "../../../modules/s3-blob-storage"
  bucket        = aws_s3_bucket.blobs
  iam_user_name = "tearleads-prod-blobs"
}
