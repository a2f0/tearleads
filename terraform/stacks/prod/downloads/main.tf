resource "aws_s3_bucket" "downloads" {
  bucket        = "downloads.tearleads.com"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

module "downloads" {
  source = "../../../modules/s3-downloads"
  bucket = aws_s3_bucket.downloads
}
