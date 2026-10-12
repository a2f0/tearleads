variable "account_id" {
  description = "Cloudflare account owning the bucket"
  type        = string
}
variable "bucket_name" {
  description = "Bucket owned by the environment stack"
  type        = string
}
variable "public_domain" {
  description = "Public download hostname and zone; null keeps application blobs private"
  type = object({
    hostname = string
    zone_id  = string
  })
  default = null
}
