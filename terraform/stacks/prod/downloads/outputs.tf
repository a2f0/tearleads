output "bucket" {
  description = "Electrobun download bucket identity and region"
  value = {
    name   = aws_s3_bucket.downloads.id
    arn    = aws_s3_bucket.downloads.arn
    region = aws_s3_bucket.downloads.region
  }
}

output "download_base_url" {
  description = "Public HTTPS S3 URL for Electrobun release downloads"
  value       = module.downloads.download_base_url
}
