variable "bucket" {
  description = "Bucket owned by the environment's downloads stack"
  type = object({
    id     = string
    arn    = string
    region = string
  })
}
